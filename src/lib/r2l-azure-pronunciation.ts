/**
 * Azure pronunciation assessment wrapper (V2.1 echo_challenge).
 * Falls back to null on network/SDK failure — caller uses Whisper or effort-only.
 */

export type PronunciationLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type PronunciationErrorType = 'None' | 'Omission' | 'Insertion' | 'Mispronunciation';

export interface PronunciationWord {
  word: string;
  accuracy_score: number;
  error_type: PronunciationErrorType;
}

export interface PronunciationResult {
  overall_score: number;
  accuracy_score: number;
  fluency_score: number;
  prosody_score: number;
  words: PronunciationWord[];
  passed: boolean;
  grading_mode: 'effort' | 'accuracy' | 'composite';
}

export interface AzurePronunciationConfig {
  speechKey: string;
  speechRegion: string;
}

type AzureAssessor = (
  audioBlob: Blob,
  referenceText: string,
  config: AzurePronunciationConfig,
) => Promise<PronunciationResult | null>;

let assessorOverride: AzureAssessor | null = null;

/** Test hook — inject mock Azure assessor. */
export function setAzureAssessorForTests(fn: AzureAssessor | null): void {
  assessorOverride = fn;
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function gradingModeForLevel(level: PronunciationLevel): PronunciationResult['grading_mode'] {
  if (level === 'L1' || level === 'L2') return 'effort';
  if (level === 'L3') return 'accuracy';
  return 'composite';
}

function passThresholdForLevel(level: PronunciationLevel): number {
  if (level === 'L1' || level === 'L2') return 1;
  if (level === 'L3') return 70;
  return 80;
}

function compositeScore(result: PronunciationResult, level: PronunciationLevel): number {
  if (level === 'L4') {
    return Math.round((result.accuracy_score * 0.6) + (result.fluency_score * 0.4));
  }
  return Math.round(
    (result.accuracy_score * 0.5) + (result.fluency_score * 0.3) + (result.prosody_score * 0.2),
  );
}

function applyLevelGrading(result: PronunciationResult, level: PronunciationLevel): PronunciationResult {
  const mode = gradingModeForLevel(level);
  const threshold = passThresholdForLevel(level);
  let passed = false;

  if (mode === 'effort') {
    passed = result.overall_score > 0;
  } else if (mode === 'accuracy') {
    passed = result.accuracy_score >= threshold;
  } else {
    const composite = compositeScore(result, level);
    result.overall_score = composite;
    passed = composite >= threshold;
  }

  return { ...result, passed, grading_mode: mode };
}

function normalizeAzurePayload(raw: Record<string, unknown>): PronunciationResult {
  const words = Array.isArray(raw.words)
    ? raw.words.map((entry) => {
        const word = entry as Record<string, unknown>;
        return {
          word: String(word.word || ''),
          accuracy_score: clampScore(word.accuracy_score),
          error_type: (['None', 'Omission', 'Insertion', 'Mispronunciation'].includes(String(word.error_type))
            ? String(word.error_type)
            : 'None') as PronunciationErrorType,
        };
      })
    : [];

  return {
    overall_score: clampScore(raw.overall_score),
    accuracy_score: clampScore(raw.accuracy_score),
    fluency_score: clampScore(raw.fluency_score),
    prosody_score: clampScore(raw.prosody_score),
    words,
    passed: false,
    grading_mode: 'effort',
  };
}

async function defaultAzureAssessor(
  audioBlob: Blob,
  referenceText: string,
  config: AzurePronunciationConfig,
): Promise<PronunciationResult | null> {
  if (!config.speechKey || !config.speechRegion) return null;

  try {
    const sdk = await import('microsoft-cognitiveservices-speech-sdk');
    const speechConfig = sdk.SpeechConfig.fromSubscription(config.speechKey, config.speechRegion);
    speechConfig.speechRecognitionLanguage = 'en-US';

    const buffer = await audioBlob.arrayBuffer();
    const pushStream = sdk.AudioInputStream.createPushStream();
    pushStream.write(buffer);
    pushStream.close();
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true,
    );
    pronunciationConfig.applyTo(recognizer);

    const outcome = await new Promise<sdk.SpeechRecognitionResult>((resolve, reject) => {
      recognizer.recognizeOnceAsync(resolve, reject);
    });
    recognizer.close();

    const detail = sdk.PronunciationAssessmentResult.fromResult(outcome);
    return normalizeAzurePayload({
      overall_score: detail.pronunciationScore,
      accuracy_score: detail.accuracyScore,
      fluency_score: detail.fluencyScore,
      prosody_score: detail.prosodyScore,
      words: [],
    });
  } catch {
    return null;
  }
}

export async function assessPronunciation(
  audioBlob: Blob,
  referenceText: string,
  level: PronunciationLevel,
  config?: Partial<AzurePronunciationConfig>,
): Promise<PronunciationResult | null> {
  const azureConfig: AzurePronunciationConfig = {
    speechKey: String(config?.speechKey || (typeof process !== 'undefined' ? process.env?.AZURE_SPEECH_KEY : '') || ''),
    speechRegion: String(config?.speechRegion || (typeof process !== 'undefined' ? process.env?.AZURE_SPEECH_REGION : '') || 'southeastasia'),
  };

  const assessor = assessorOverride || defaultAzureAssessor;
  try {
    const raw = await assessor(audioBlob, referenceText, azureConfig);
    if (!raw) return null;
    return applyLevelGrading(raw, level);
  } catch {
    return null;
  }
}

export function effortOnlyFallback(spoke: boolean): PronunciationResult {
  return {
    overall_score: spoke ? 60 : 0,
    accuracy_score: spoke ? 60 : 0,
    fluency_score: spoke ? 60 : 0,
    prosody_score: spoke ? 60 : 0,
    words: [],
    passed: spoke,
    grading_mode: 'effort',
  };
}
