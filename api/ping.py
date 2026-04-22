from fastapi import FastAPI
import sys
import traceback

app = FastAPI()

@app.get("/api/ping")
def ping():
    results = {"status": "testing_imports"}
    
    # Тест 1: peewee
    try:
        import peewee
        results["peewee"] = "OK"
    except Exception as e:
        results["peewee"] = f"ERROR: {str(e)}"

    # Тест 2: psycopg2
    try:
        import psycopg2
        results["psycopg2"] = "OK"
    except Exception as e:
        results["psycopg2"] = f"ERROR: {str(e)}"

    # Тест 3: supabase
    try:
        import supabase
        results["supabase"] = "OK"
    except Exception as e:
        results["supabase"] = f"ERROR: {str(e)}"
        
    return results

@app.get("/api/ping/models")
def test_models():
    try:
        import models
        return {"models": "OK"}
    except Exception as e:
        return {"error": str(e), "traceback": traceback.format_exc()}
