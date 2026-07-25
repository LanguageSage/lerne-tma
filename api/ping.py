from fastapi import FastAPI
import sys
import traceback

app = FastAPI()

@app.get("/")
@app.get("/ping")
@app.get("/api/ping")
def ping():
    results = {"status": "testing_imports"}
    
    try:
        import peewee
        results["peewee"] = "OK"
    except Exception as e:
        results["peewee"] = f"ERROR: {str(e)}"

    try:
        import psycopg2
        results["psycopg2"] = "OK"
    except Exception as e:
        results["psycopg2"] = f"ERROR: {str(e)}"

    try:
        import supabase
        results["supabase"] = "OK"
    except Exception as e:
        results["supabase"] = f"ERROR: {str(e)}"

    try:
        import api.models
        results["api_models"] = "OK"
    except Exception as e:
        results["api_models"] = f"ERROR: {str(e)}, trace: {traceback.format_exc()}"
        
    return results

handler = app

