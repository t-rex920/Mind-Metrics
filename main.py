import joblib
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import Literal
from fastapi.middleware.cors import CORSMiddleware

# Load the trained model once at startup (not on every request)
model = joblib.load('Mental_Health_Score_Model.pkl')

# Countries the model knows individually; all others are grouped as 'Other'
top_countries = ['Other', 'India', 'USA', 'Canada', 'Australia', 'UK', 'Germany', 'Mexico', 'Turkey', 'France']

app = FastAPI()

# Allow the frontend (any origin) to call this API from the browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Input schema: FastAPI validates every request against this model
# and returns a 422 error automatically if anything is invalid
class StudentData(BaseModel):
    age : int = Field(..., ge=10, le=100)
    gender : Literal['Male', 'Female']
    country : str
    academic_level : Literal['Undergraduate', 'Graduate', 'High School']
    most_used_platform : Literal['Facebook', 'LinkedIn', 'Instagram', 'Snapchat', 'Twitter', 'YouTube', 'TikTok', 'LINE', 'KakaoTalk', 'VKontakte', 'WhatsApp', 'WeChat']
    purpose_of_use : Literal['Networking', 'Education', 'Entertainment', 'News']
    avg_daily_usage_hours : float = Field(..., ge=0, le=24)
    daily_unlocks : int = Field(..., ge=0)
    study_hours : float = Field(..., ge=0, le=24)
    physical_activity_hours : float = Field(..., ge=0, le=24)
    sleep_hours_per_night : float = Field(..., ge=0, le=24)
    stress_level : Literal['Medium', 'Low', 'Very High', 'High']

# Output schema: the shape of the JSON we send back
class PredictionResponse(BaseModel):
    predicted_mental_health_score : float

# Simple health-check route to confirm the server is running
@app.get('/')
def greet():
    return {'Hello, Raj Pandit!'}

# Prediction endpoint: receives student data, returns the predicted score
@app.post('/predict', response_model=PredictionResponse)
def predict(data: StudentData):
    # Group rare countries into 'Other' (used as an extra model feature)
    country_group = data.country if data.country in top_countries else "Other"

    # Build a one-row DataFrame; column names must match the training data exactly
    input_row = pd.DataFrame([{
        'Age' : data.age,
        'Gender' : data.gender,
        'Country' : data.country,
        'Academic_Level' : data.academic_level,
        'Most_Used_Platform' : data.most_used_platform,
        'Purpose_Of_Use' : data.purpose_of_use,
        'Avg_Daily_Usage_Hours' : data.avg_daily_usage_hours,
        'Daily_Unlocks' : data.daily_unlocks,
        'Study_Hours' : data.study_hours,
        'Physical_Activity_Hours' : data.physical_activity_hours,
        'Sleep_Hours_Per_Night' : data.sleep_hours_per_night,
        'Stress_Level' : data.stress_level,
        'Grouped_Country' : country_group
    }])

    # Predict, take the first (only) result, and round it to 2 decimals
    prediction = model.predict(input_row)[0]
    return PredictionResponse(predicted_mental_health_score=round(float(prediction), 2))
