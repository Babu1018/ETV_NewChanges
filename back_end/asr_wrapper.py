# asr_wrapper.py 
import os
import asyncio
from fastapi import UploadFile
from io import BytesIO
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import your existing routers
from eng_asr_api import english_transcription_api
from hin_asr_api import hindi_transcription_api
from tel_asr_api import telugu_transcription_api

# Get API key from .env
API_AUTH_KEY = os.getenv("API_AUTH_KEY", "test_key_123")

def run_async(coro):
    """Run async function in sync context"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    
    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()
    else:
        return asyncio.run(coro)

def transcribe_english(audio_path: str) -> str:
    """Wrapper for English transcription - NO API key needed"""
    async def _transcribe():
        # Read audio file
        with open(audio_path, 'rb') as f:
            audio_data = f.read()
        
        # Create UploadFile object
        upload_file = UploadFile(
            filename=os.path.basename(audio_path),
            file=BytesIO(audio_data)
        )
        
        # Call English API (no API key required)
        result = await english_transcription_api(request=None, file=upload_file)
        
        await upload_file.close()
        
        # Parse result
        if hasattr(result, 'body'):
            import json
            body = json.loads(result.body)
            return body.get('transcription', '')
        elif isinstance(result, dict):
            return result.get('transcription', '')
        else:
            return str(result)
    
    return run_async(_transcribe())

def transcribe_hindi(audio_path: str) -> str:
    """Wrapper for Hindi transcription - requires API key"""
    async def _transcribe():
        # Read audio file
        with open(audio_path, 'rb') as f:
            audio_data = f.read()
        
        # Create UploadFile object
        upload_file = UploadFile(
            filename=os.path.basename(audio_path),
            file=BytesIO(audio_data)
        )
        
        # Create mock request with API key for Hindi
        from starlette.requests import Request
        from starlette.datastructures import Headers
        
        headers = Headers({"x-api-key": API_AUTH_KEY})
        scope = {
            "type": "http",
            "headers": headers.raw,
            "client": ("127.0.0.1", 8000)
        }
        mock_request = Request(scope)
        
        # Call Hindi API
        result = await hindi_transcription_api(request=mock_request, file=upload_file)
        
        await upload_file.close()
        
        # Parse result
        if hasattr(result, 'body'):
            import json
            body = json.loads(result.body)
            return body.get('transcription', '')
        elif isinstance(result, dict):
            return result.get('transcription', '')
        else:
            return str(result)
    
    return run_async(_transcribe())

def transcribe_telugu(audio_path: str) -> str:
    """Wrapper for Telugu transcription - requires API key"""
    async def _transcribe():
        # Read audio file
        with open(audio_path, 'rb') as f:
            audio_data = f.read()
        
        # Create UploadFile object
        upload_file = UploadFile(
            filename=os.path.basename(audio_path),
            file=BytesIO(audio_data)
        )
        
        # Create mock request with API key for Telugu
        from starlette.requests import Request
        from starlette.datastructures import Headers
        
        headers = Headers({"x-api-key": API_AUTH_KEY})
        scope = {
            "type": "http",
            "headers": headers.raw,
            "client": ("127.0.0.1", 8000)
        }
        mock_request = Request(scope)
        
        # Call Telugu API
        result = await telugu_transcription_api(request=mock_request, file=upload_file)
        
        await upload_file.close()
        
        # Parse result
        if hasattr(result, 'body'):
            import json
            body = json.loads(result.body)
            return body.get('transcription', '')
        elif isinstance(result, dict):
            return result.get('transcription', '')
        else:
            return str(result)
    
    return run_async(_transcribe())