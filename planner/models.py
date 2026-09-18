from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

FOCUS_LEVELS = [('HIGH', 'HIGH'), ('MEDIUM', 'MEDIUM'), ('LOW', 'LOW')]


class Task(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='tasks')
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100)
    difficulty = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    estimated_time = models.FloatField()
    due_date = models.DateField()
    status = models.CharField(max_length=10, default='pending',
                              choices=[('pending', 'pending'), ('completed', 'completed')])
    priority = models.IntegerField(default=3)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)


class FocusLog(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='focus_logs')
    task = models.ForeignKey(Task, on_delete=models.SET_NULL, null=True, blank=True)
    hour_of_day = models.IntegerField()
    difficulty = models.IntegerField()
    estimated_time = models.FloatField()
    predicted_focus = models.CharField(max_length=10, choices=FOCUS_LEVELS)
    confidence = models.FloatField()
    logged_at = models.DateTimeField(auto_now_add=True)


class ScheduleEntry(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='schedule')
    task = models.ForeignKey(Task, on_delete=models.CASCADE)
    suggested_date = models.DateField()
    suggested_hour = models.IntegerField()
    focus_level = models.CharField(max_length=10, choices=FOCUS_LEVELS)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
