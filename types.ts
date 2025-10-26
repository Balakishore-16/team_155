export interface DetectionSource {
  title: string;
  uri: string;
}

export interface DetectionResult {
  verdict: 'Fake' | 'Real' | 'Uncertain';
  confidenceScore: number;
  explanation: string;
  sources: DetectionSource[];
  language: string; // e.g., 'en-US', 'te-IN', 'hi-IN'
  translatedExplanation?: string;
  realNewsSummary?: string;
  translatedRealNewsSummary?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  isError?: boolean;
}