# check_wrapper.py - Check what's actually in your wrapper
import inspect

from asr_wrapper import transcribe_english, transcribe_hindi, transcribe_telugu

print("=== Checking asr_wrapper.py ===\n")

print("transcribe_english source:")
print(inspect.getsource(transcribe_english))
print("\n" + "="*50 + "\n")

print("transcribe_hindi source:")
print(inspect.getsource(transcribe_hindi))
print("\n" + "="*50 + "\n")

print("transcribe_telugu source:")
print(inspect.getsource(transcribe_telugu))