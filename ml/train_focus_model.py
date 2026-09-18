import numpy as np
import joblib
import os
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

np.random.seed(42)
N = 3000

hours = np.random.randint(0, 24, N)
difficulties = np.random.randint(1, 6, N)
durations = np.random.uniform(0.5, 6.0, N)

def focus_rule(hour, diff, dur):
    """
    Returns a continuous score then maps to HIGH/MEDIUM/LOW
    using thresholds calibrated so each class gets ~33% of samples.
    """
    score = 0.0

    # Time-of-day component (range: -4 to +4)
    if 8 <= hour <= 10:
        score += 4.0      # Peak morning
    elif hour == 11:
        score += 3.0
    elif 19 <= hour <= 21:
        score += 2.5      # Evening focus
    elif hour == 7 or hour == 12:
        score += 1.5
    elif 13 <= hour <= 15:
        score -= 1.5      # Post-lunch dip
    elif hour == 16 or hour == 17:
        score += 0.5
    elif 22 <= hour <= 23:
        score -= 2.5
    elif 0 <= hour <= 5:
        score -= 4.0      # Deep night
    elif hour == 6:
        score -= 1.0

    # Difficulty component (range: -2 to +1)
    score -= (diff - 3) * 0.8   # diff=1→+1.6, diff=3→0, diff=5→-1.6

    # Duration component (range: -2 to +1)
    score -= (dur - 2.0) * 0.5  # dur=0.5→+0.75, dur=2→0, dur=6→-2.0

    # Gaussian noise for realistic variance
    score += np.random.normal(0, 1.0)

    # Thresholds: HIGH >= 1.5, MEDIUM 0..1.5, LOW < 0
    if score >= 1.5:
        return 'HIGH'
    elif score >= -0.5:
        return 'MEDIUM'
    else:
        return 'LOW'

labels = [focus_rule(hours[i], difficulties[i], durations[i]) for i in range(N)]

# Print class distribution
from collections import Counter
dist = Counter(labels)
print(f"Class distribution: {dict(dist)}")
for cls, cnt in dist.items():
    print(f"  {cls}: {cnt/N*100:.1f}%")

X = np.column_stack([hours, difficulties, durations])
le = LabelEncoder()
y = le.fit_transform(labels)

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = GradientBoostingClassifier(
    n_estimators=200,
    max_depth=4,
    learning_rate=0.08,
    subsample=0.85,
    random_state=42
)
model.fit(X_train, y_train)

accuracy = model.score(X_test, y_test)
print(f"Model accuracy: {accuracy:.2%}")
print(f"Classes: {le.classes_}")

model_dir = os.path.dirname(os.path.abspath(__file__))
joblib.dump(model, os.path.join(model_dir, 'focus_model.pkl'))
joblib.dump(le, os.path.join(model_dir, 'label_encoder.pkl'))
print("Model saved to ml/focus_model.pkl")