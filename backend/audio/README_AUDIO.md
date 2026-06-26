# Read2Lead Story Audio Generation

This folder contains a simple OpenAI TTS script for converting one plain-text story into one MP3 narration file.

The MP3 should read only the story. It should not include worksheet exercises, chunk practice, answer keys, audio part labels, listen/repeat instructions, or teacher notes.

This tool does not create HTML, PDF, an app, a dashboard, or a JSON renderer.

## Install Dependency

```powershell
pip install openai
```

## Set API Key On Windows

Recommended for this project: use `READ2LEAD_OPENAI_API_KEY`.

The script checks keys in this order:

1. `READ2LEAD_OPENAI_API_KEY`
2. `OPENAI_API_KEY`

It is okay for the script to print which environment variable is being used. It never prints the key value.

### Recommended: Set `READ2LEAD_OPENAI_API_KEY`

For the current PowerShell window:

```powershell
$env:READ2LEAD_OPENAI_API_KEY="your_api_key_here"
```

To save it permanently for your Windows user:

```powershell
setx READ2LEAD_OPENAI_API_KEY "your_api_key_here"
```

After using `setx`, close and reopen PowerShell before running the script.

### Fallback: Set `OPENAI_API_KEY`

If `READ2LEAD_OPENAI_API_KEY` is not set, the script falls back to `OPENAI_API_KEY`.

```powershell
$env:OPENAI_API_KEY="your_api_key_here"
```

Never paste the API key into any project file.

## Prepare Story Text

Use a plain `.txt` file with only:

1. Story title
2. Story text

Do not include:

- worksheet exercises
- answer key
- chunk practice
- audio part labels
- listen/repeat instructions
- teacher notes

Example input:

```text
audio/sample_story_text.txt
```

## Run The Script

From the project root:

```powershell
python audio/generate_story_audio_openai.py --input audio/sample_story_text.txt --output generated/audio/Coolkid_Bike_Challenge_Audio.mp3
```

Optional explicit model, voice, speed, and loudness:

```powershell
python audio/generate_story_audio_openai.py --input audio/sample_story_text.txt --output generated/audio/Coolkid_Bike_Challenge_Audio.mp3 --voice nova --model tts-1 --speed 0.78 --target-lufs -16
```

## Output Location

The MP3 file appears here:

```text
generated/audio/Coolkid_Bike_Challenge_Audio.mp3
```

The script creates the output folder automatically if it does not exist.

## Recommended Default

Use:

```text
model = tts-1
voice = nova
speed = 0.78
output = mp3
loudness normalization = -16 LUFS
```

Do not use `tts-1-hd` unless Felix explicitly asks.

The default speed is intentionally slower than normal speech so young Vietnamese English learners can hear each word clearly. The generated MP3 is normalized with FFmpeg so it is loud enough on phone and laptop speakers. If FFmpeg is not installed, the script still creates the raw OpenAI MP3 and prints a warning.

## Approximate Cost

The script estimates cost before generation using:

```text
tts-1 = $15 per 1,000,000 characters
```

Example:

```text
3,000 characters ≈ $0.045 with tts-1
```

The estimate is only for `tts-1`. If you override the model, check current OpenAI pricing separately.

## Test The MP3

After generation:

1. Open `generated/audio/Coolkid_Bike_Challenge_Audio.mp3`.
2. Confirm the file plays.
3. Confirm it reads only the story title and story text.
4. Confirm it does not read exercises, answer key, chunk practice, or teacher notes.
5. Check that the voice is understandable for a child.
