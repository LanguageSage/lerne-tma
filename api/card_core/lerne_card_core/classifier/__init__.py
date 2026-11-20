"""
api/services/classifier/__init__.py

Entry point for the local rule-based CEFR classifier.
Supports German (de) only; other languages return confidence=0.0 (AI fallback).
No external dependencies — pure Python, runs on Vercel Serverless with zero overhead.
"""

from .pipeline import classify_sentence_fast

__all__ = ["classify_sentence_fast"]
