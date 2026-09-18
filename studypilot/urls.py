from django.urls import path
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.generic import TemplateView

from planner import views

urlpatterns = [
    path('', ensure_csrf_cookie(TemplateView.as_view(template_name='index.html'))),
    path('signup', views.signup),
    path('login', views.login_view),
    path('logout', views.logout_view),
    path('me', views.me),
    path('tasks', views.tasks),
    path('tasks/<int:task_id>', views.task_detail),
    path('predict-focus', views.predict),
    path('generate-schedule', views.generate_schedule),
    path('schedule', views.get_schedule),
    path('stats', views.stats),
    path('api/chat', views.chat),
]
