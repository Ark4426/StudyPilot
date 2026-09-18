import numpy as np
import joblib
import os

_model = None
_encoder = None

def _load_model():
    global _model, _encoder
    if _model is None:
        model_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(model_dir, 'focus_model.pkl')
        encoder_path = os.path.join(model_dir, 'label_encoder.pkl')
        if not os.path.exists(model_path):
            # Auto-train if not present
            import subprocess, sys
            subprocess.run([sys.executable, os.path.join(model_dir, 'train_focus_model.py')])
        _model = joblib.load(model_path)
        _encoder = joblib.load(encoder_path)

def predict_focus(hour_of_day: int, difficulty: int, estimated_time: float) -> dict:
    _load_model()
    X = np.array([[hour_of_day, difficulty, estimated_time]])
    proba = _model.predict_proba(X)[0]
    pred_idx = np.argmax(proba)
    focus_level = _encoder.inverse_transform([pred_idx])[0]
    confidence = float(proba[pred_idx])

    # Build full probability map
    prob_map = {_encoder.classes_[i]: round(float(p), 3) for i, p in enumerate(proba)}

    return {
        'focus_level': focus_level,
        'confidence': round(confidence, 3),
        'probabilities': prob_map,
        'input': {
            'hour_of_day': hour_of_day,
            'difficulty': difficulty,
            'estimated_time': estimated_time
        }
    }