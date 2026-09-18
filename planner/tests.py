import json
from datetime import date, timedelta

from django.test import Client, TestCase


class StudyPilotFlowTest(TestCase):
    """End-to-end API flow, with CSRF enforced like the browser."""

    def call(self, method, path, body=None):
        return getattr(self.c, method)(path, json.dumps(body or {}), content_type='application/json',
                                       HTTP_X_CSRFTOKEN=self.c.cookies['csrftoken'].value)

    def test_full_flow(self):
        self.c = Client(enforce_csrf_checks=True)
        self.assertEqual(self.c.get('/').status_code, 200)  # sets csrftoken cookie
        self.assertEqual(self.c.get('/me').status_code, 401)

        r = self.call('post', '/signup', {'username': 'ana', 'email': 'a@x.com', 'password': 'secret1'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.c.get('/me').json()['username'], 'ana')
        self.assertEqual(self.call('post', '/signup', {'username': 'bob', 'email': 'A@x.com', 'password': 'secret1'}).status_code, 409)

        due = (date.today() + timedelta(days=2)).isoformat()
        task = {'title': 'Ch 5', 'subject': 'Math', 'difficulty': 3, 'estimated_time': 1.5, 'due_date': due}
        r = self.call('post', '/tasks', task)
        self.assertEqual(r.status_code, 201, r.content)
        tid = r.json()['id']
        self.assertEqual(r.json()['due_date'], due)
        self.assertEqual(self.call('post', '/tasks', {**task, 'difficulty': 9}).status_code, 400)
        self.assertEqual(self.call('post', '/tasks', {**task, 'due_date': 'nope'}).status_code, 400)

        r = self.call('post', '/predict-focus', {'hour_of_day': 9, 'difficulty': 3, 'estimated_time': 1.5, 'task_id': tid})
        self.assertIn(r.json()['focus_level'], ['HIGH', 'MEDIUM', 'LOW'])

        sched = self.call('post', '/generate-schedule').json()['schedule']
        self.assertEqual([s['task_id'] for s in sched], [tid])
        self.assertEqual(self.c.get('/schedule').json()[0]['task_title'], 'Ch 5')

        r = self.call('put', f'/tasks/{tid}', {'status': 'completed'})
        self.assertIsNotNone(r.json()['completed_at'])
        stats = self.c.get('/stats').json()
        self.assertEqual((stats['completed_tasks'], stats['productivity_score']), (1, 100.0))
        self.assertEqual(sum(sum(d.values()) for d in stats['focus_trend'].values()), 1)
        self.assertEqual(stats['daily_completions'][0]['count'], 1)

        self.assertIn('reply', self.call('post', '/api/chat', {'messages': [{'role': 'user', 'content': 'exam tips'}]}).json())

        # other users can't touch ana's task
        self.call('post', '/logout')
        self.call('post', '/signup', {'username': 'bob', 'email': 'b@x.com', 'password': 'secret1'})
        self.assertEqual(self.call('delete', f'/tasks/{tid}').status_code, 404)
        self.call('post', '/logout')
        self.call('post', '/login', {'username': 'ana', 'password': 'secret1'})
        self.assertEqual(self.call('delete', f'/tasks/{tid}').status_code, 200)
        self.assertEqual(self.c.get('/tasks').json(), [])

    def test_csrf_required(self):
        c = Client(enforce_csrf_checks=True)
        r = c.post('/signup', json.dumps({'username': 'x', 'email': 'x@x.com', 'password': 'secret1'}),
                   content_type='application/json')
        self.assertEqual(r.status_code, 403)
