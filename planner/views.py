import json
import urllib.request
from datetime import timedelta
from functools import wraps

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Avg, Count, F, Q
from django.db.models.functions import TruncDate
from django.http import HttpResponseNotAllowed, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from ml.focus_predictor import predict_focus
from planner.models import FocusLog, ScheduleEntry, Task

# Hours considered good for study (morning and afternoon peaks)
STUDY_HOURS = [7, 8, 9, 10, 14, 15, 16, 17, 19, 20]
TASK_FIELDS = ['title', 'subject', 'difficulty', 'estimated_time', 'due_date', 'status', 'priority']
REQUIRED_TASK_FIELDS = ['title', 'subject', 'difficulty', 'estimated_time', 'due_date']


def api_login_required(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Not authenticated'}, status=401)
        return view(request, *args, **kwargs)
    return wrapper


def _json(request):
    try:
        data = json.loads(request.body or b'{}')
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


# ─── AUTH ────────────────────────────────────────────────────
@require_POST
def signup(request):
    data = _json(request)
    username = str(data.get('username', '')).strip()
    email = str(data.get('email', '')).strip()
    password = str(data.get('password', ''))

    if not username or not email or not password:
        return JsonResponse({'error': 'All fields required'}, status=400)
    if len(password) < 6:
        return JsonResponse({'error': 'Password must be at least 6 characters'}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return JsonResponse({'error': 'Username or email already exists'}, status=409)
    try:
        user = User.objects.create_user(username, email, password)
    except IntegrityError:
        return JsonResponse({'error': 'Username or email already exists'}, status=409)

    login(request, user)
    return JsonResponse({'message': 'Account created', 'username': username}, status=201)


@require_POST
def login_view(request):
    data = _json(request)
    username = str(data.get('username', '')).strip()
    user = authenticate(request, username=username, password=str(data.get('password', '')))
    if user is None:
        return JsonResponse({'error': 'Invalid credentials'}, status=401)
    login(request, user)
    return JsonResponse({'message': 'Logged in', 'username': username})


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({'message': 'Logged out'})


@require_GET
@api_login_required
def me(request):
    return JsonResponse({'user_id': request.user.id, 'username': request.user.username})


# ─── TASKS ───────────────────────────────────────────────────
def _save_task(task, status=200):
    try:
        task.full_clean()
    except ValidationError as e:
        msg = '; '.join(f'{field}: {" ".join(errs)}' for field, errs in e.message_dict.items())
        return JsonResponse({'error': msg}, status=400)
    task.save()
    return JsonResponse(Task.objects.filter(pk=task.pk).values().get(), status=status)


@api_login_required
def tasks(request):
    if request.method == 'GET':
        return JsonResponse(list(request.user.tasks.order_by('due_date').values()), safe=False)
    if request.method == 'POST':
        data = _json(request)
        if not all(k in data for k in REQUIRED_TASK_FIELDS):
            return JsonResponse({'error': 'Missing fields'}, status=400)
        task = Task(user=request.user, priority=data.get('priority', 3),
                    **{k: data[k] for k in REQUIRED_TASK_FIELDS})
        return _save_task(task, status=201)
    return HttpResponseNotAllowed(['GET', 'POST'])


@api_login_required
def task_detail(request, task_id):
    task = request.user.tasks.filter(pk=task_id).first()
    if task is None:
        return JsonResponse({'error': 'Task not found'}, status=404)

    if request.method == 'PUT':
        data = _json(request)
        if data.get('status') == 'completed' and task.status != 'completed':
            task.completed_at = timezone.now()
        for k in TASK_FIELDS:
            if k in data:
                setattr(task, k, data[k])
        return _save_task(task)
    if request.method == 'DELETE':
        task.delete()
        return JsonResponse({'message': 'Deleted'})
    return HttpResponseNotAllowed(['PUT', 'DELETE'])


# ─── FOCUS ───────────────────────────────────────────────────
@require_POST
@api_login_required
def predict(request):
    data = _json(request)
    try:
        hour = int(data['hour_of_day'])
        difficulty = int(data['difficulty'])
        estimated_time = float(data['estimated_time'])
    except (KeyError, TypeError, ValueError):
        return JsonResponse({'error': 'hour_of_day, difficulty and estimated_time are required numbers'}, status=400)

    if not 0 <= hour <= 23 or not 1 <= difficulty <= 5 or estimated_time <= 0:
        return JsonResponse({'error': 'hour_of_day 0-23, difficulty 1-5, estimated_time > 0'}, status=400)

    result = predict_focus(hour, difficulty, estimated_time)

    task_id = data.get('task_id')
    task = request.user.tasks.filter(pk=task_id).first() if isinstance(task_id, int) else None
    FocusLog.objects.create(
        user=request.user, task=task, hour_of_day=hour, difficulty=difficulty,
        estimated_time=estimated_time, predicted_focus=result['focus_level'], confidence=result['confidence'],
    )
    return JsonResponse(result)


# ─── SCHEDULE ────────────────────────────────────────────────
@require_POST
@api_login_required
@transaction.atomic
def generate_schedule(request):
    pending = request.user.tasks.filter(status='pending').order_by('due_date', '-priority')
    if not pending:
        return JsonResponse({'message': 'No pending tasks', 'schedule': []})

    request.user.schedule.all().delete()
    today = timezone.localdate()
    entries = []

    for task in pending:
        # ponytail: the Flask version also looped over the next 7 days, but the model has no
        # date feature, so every day scores the same and the pick was always today.
        best = None
        for hour in STUDY_HOURS:
            result = predict_focus(hour, task.difficulty, task.estimated_time)
            if best is None or result['confidence'] > best['confidence']:
                best = {'hour': hour, **result}
                if result['focus_level'] == 'HIGH' and result['confidence'] > 0.8:
                    break

        reason = _build_reason(best, (task.due_date - today).days)
        entry = ScheduleEntry.objects.create(
            user=request.user, task=task, suggested_date=today,
            suggested_hour=best['hour'], focus_level=best['focus_level'], reason=reason,
        )
        entries.append({
            'id': entry.id,
            'task_id': task.id,
            'task_title': task.title,
            'subject': task.subject,
            'suggested_date': today.isoformat(),
            'suggested_hour': best['hour'],
            'focus_level': best['focus_level'],
            'confidence': round(best['confidence'], 2),
            'reason': reason,
            'estimated_time': task.estimated_time,
        })

    return JsonResponse({'schedule': entries})


@require_GET
@api_login_required
def get_schedule(request):
    rows = request.user.schedule.order_by('suggested_date', 'suggested_hour').values(
        'id', 'user_id', 'task_id', 'suggested_date', 'suggested_hour', 'focus_level', 'reason', 'created_at',
        task_title=F('task__title'), subject=F('task__subject'),
        estimated_time=F('task__estimated_time'), difficulty=F('task__difficulty'),
    )
    return JsonResponse(list(rows), safe=False)


def _build_reason(slot, days_until_due):
    urgency = 'urgent' if days_until_due <= 1 else 'upcoming' if days_until_due <= 3 else 'planned'
    return f"{slot['focus_level']} focus predicted at {slot['hour']}:00 — {urgency} deadline"


# ─── ANALYTICS ───────────────────────────────────────────────
@require_GET
@api_login_required
def stats(request):
    tasks = request.user.tasks
    now = timezone.now()
    total = tasks.count()
    completed = tasks.filter(status='completed').count()

    focus_trend = {}
    focus_rows = (request.user.focus_logs.filter(logged_at__gte=now - timedelta(days=7))
                  .annotate(day=TruncDate('logged_at')).values('day', 'predicted_focus')
                  .annotate(count=Count('id')).order_by('day'))
    for row in focus_rows:
        day = focus_trend.setdefault(row['day'].isoformat(), {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0})
        day[row['predicted_focus']] = row['count']

    subjects = (tasks.values('subject')
                .annotate(total=Count('id'), done=Count('id', filter=Q(status='completed')))
                .order_by('subject'))

    daily_completions = (tasks.filter(status='completed', completed_at__gte=now - timedelta(days=14))
                         .annotate(day=TruncDate('completed_at')).values('day')
                         .annotate(count=Count('id')).order_by('day'))

    avg_difficulty = tasks.filter(status='completed').aggregate(avg=Avg('difficulty'))['avg'] or 0

    return JsonResponse({
        'total_tasks': total,
        'completed_tasks': completed,
        'pending_tasks': total - completed,
        'productivity_score': round(completed / total * 100 if total else 0, 1),
        'avg_difficulty': round(avg_difficulty, 1),
        'focus_trend': focus_trend,
        'subject_breakdown': list(subjects),
        'daily_completions': list(daily_completions),
    })


# ─── AI TUTOR ────────────────────────────────────────────────
STUDY_SYSTEM_PROMPT = """You are StudyPilot AI Tutor — an expert, friendly academic assistant embedded inside a study planner app. You help students with:
- Explaining concepts clearly across all subjects (Math, Science, History, Languages, etc.)
- Study strategies, memory techniques, and focus tips
- Breaking down complex topics step-by-step
- Creating study plans and schedules
- Exam preparation and practice questions
- Understanding and solving homework problems

Keep responses clear, structured, and encouraging. Use bullet points or numbered steps when helpful. Be concise but thorough. If asked about something unrelated to studying or learning, gently redirect back to academic topics."""


@require_POST
@api_login_required
def chat(request):
    messages = _json(request).get('messages')
    if not isinstance(messages, list) or not messages:
        return JsonResponse({'error': 'No messages provided'}, status=400)

    # Keep last 20 messages for context window
    messages = messages[-20:]

    if not settings.ANTHROPIC_API_KEY:
        return JsonResponse({'reply': get_fallback_response(str(messages[-1].get('content', '')).lower())})

    try:
        payload = json.dumps({
            'model': 'claude-haiku-4-5-20251001',
            'max_tokens': 1024,
            'system': STUDY_SYSTEM_PROMPT,
            'messages': messages,
        }).encode('utf-8')
        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'x-api-key': settings.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        return JsonResponse({'reply': result['content'][0]['text']})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


def get_fallback_response(msg):
    """Smart fallback when no API key is set."""
    if any(w in msg for w in ['focus', 'concentrate', 'distract']):
        return "Great question about focus! Here are proven techniques:\n\n• **Pomodoro Technique**: 25 min work + 5 min break\n• **Eliminate distractions**: Phone on silent, website blockers\n• **Single-tasking**: One task at a time\n• **Environment**: Clean desk, good lighting\n• **Body**: Stay hydrated, avoid heavy meals before studying\n\nThe app's Focus Predictor can tell you your best study hours!"
    if any(w in msg for w in ['study plan', 'schedule', 'organize']):
        return "Here's how to build an effective study plan:\n\n1. **List all subjects/tasks** — use the Planner tab\n2. **Prioritize by deadline and difficulty**\n3. **Use the Smart Scheduler** — it picks your peak focus hours\n4. **Block time daily** — consistency beats cramming\n5. **Review weekly** — adjust based on progress\n\nTip: Study hardest subjects during HIGH focus periods (usually 8–11am)!"
    if any(w in msg for w in ['exam', 'test', 'quiz']):
        return "Exam preparation tips:\n\n• **Spaced repetition**: Review material over multiple days\n• **Active recall**: Test yourself instead of re-reading\n• **Past papers**: Practice with real exam questions\n• **Teach it**: Explain concepts to someone else\n• **Sleep**: Don't sacrifice sleep before exams — memory consolidates during sleep\n• **Start early**: Begin revision 2 weeks before the exam"
    if any(w in msg for w in ['math', 'calculus', 'algebra', 'equation']):
        return "For Mathematics:\n\n• **Understand, don't memorize**: Focus on WHY formulas work\n• **Practice daily**: Math is a skill — 30 min/day beats 3 hours once a week\n• **Work examples step-by-step**: Write every step out\n• **Identify weak areas**: Use past mistakes as a guide\n• **Resources**: Khan Academy, Wolfram Alpha for checking work\n\nWhat specific math topic can I help you with?"
    if any(w in msg for w in ['memory', 'remember', 'memorize', 'forget']):
        return "Memory techniques that actually work:\n\n• **Spaced Repetition**: Review at increasing intervals (1 day → 3 days → 1 week)\n• **Mnemonics**: Create acronyms or stories\n• **Mind Maps**: Visual connections between concepts\n• **Chunking**: Group related info together\n• **Sleep**: Crucial for memory consolidation\n• **Retrieval Practice**: Test yourself — don't just re-read\n\nApps like Anki use spaced repetition automatically!"
    return "I'm your AI Study Tutor! I can help you with:\n\n• **Subject explanations** — Math, Science, History, Languages\n• **Study strategies** — focus, memory, time management\n• **Exam preparation** — tips and practice approaches\n• **Study planning** — how to organize your workload\n\n💡 **Tip**: Set your `ANTHROPIC_API_KEY` environment variable to unlock full AI-powered responses!\n\nWhat would you like help with today?"
