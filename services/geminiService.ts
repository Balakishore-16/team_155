import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";
import type { DetectionResult, ChatMessage, DetectionSource } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const JSON_PROMPT_INSTRUCTIONS = `
    Your response MUST be a single valid JSON object with ONLY the following keys: "verdict", "confidenceScore", "explanation", "language", and optionally "realNewsSummary".
    - The "verdict" must be one of 'Fake', 'Real', or 'Uncertain'.
    - The "confidenceScore" must be a number between 0 and 100.
    - The "explanation" must be a concise, one-paragraph explanation in English for the verdict.
    - The "language" must be the detected BCP-47 language code of the input text (e.g., "en-US", "hi-IN", "te-IN", "ta-IN").
    - If and ONLY IF the "verdict" is 'Fake', you MUST include the "realNewsSummary" key. This key's value should be a brief, factual summary of the true story, based on your web search. If the verdict is not 'Fake', do not include this key.
    Do not include any text, markdown, or code block formatting outside of the JSON object.
`;

export const detectFakeNews = async (newsText: string, image?: { data: string; mimeType: string }): Promise<DetectionResult> => {
    try {
        let contents: any;
        let prompt: string;

        if (image) {
            prompt = `
                Extract the text from the following news article image.
                Then, analyze the extracted text for authenticity. First, detect the primary language of the text.
                Use Google Search to find verifying sources and cross-reference the information. Your goal is to determine if the news is real or fake and explain why.
                If you determine the news is fake, you must also provide a summary of what the real news is.
                ${JSON_PROMPT_INSTRUCTIONS}
            `;
            contents = {
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: image.mimeType, data: image.data } }
                ]
            };
        } else {
            prompt = `
                Analyze the following news text for authenticity. First, detect the primary language of the text.
                Use Google Search to find verifying sources and cross-reference the information. Your goal is to determine if the news is real or fake and explain why.
                If you determine the news is fake, you must also provide a summary of what the real news is.
                
                News Text: "${newsText}"

                ${JSON_PROMPT_INSTRUCTIONS}
            `;
            contents = prompt;
        }

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: contents,
            config: {
                tools: [{ googleSearch: {} }],
            }
        });

        let jsonText = response.text.trim();
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.substring(7, jsonText.length - 3).trim();
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.substring(3, jsonText.length - 3).trim();
        }

        const partialResult = JSON.parse(jsonText) as Omit<DetectionResult, 'sources' | 'translatedExplanation' | 'translatedRealNewsSummary'>;

        const sources: DetectionSource[] = [];
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (groundingChunks) {
            for (const chunk of groundingChunks) {
                if (chunk.web) {
                    sources.push({ title: chunk.web.title || 'Source', uri: chunk.web.uri });
                }
            }
        }
        
        const result: DetectionResult = {
            ...partialResult,
            sources: sources,
        };
        
        return result;

    } catch (error) {
        console.error("Error in detectFakeNews:", error);
        if (error instanceof SyntaxError) {
             throw new Error("Analysis failed: The AI model returned an unexpected format. Please try rephrasing your input or try again later.");
        }
        throw new Error("Analysis failed: Could not connect to the AI. Please check your internet connection and try again.");
    }
};

export const translateText = async (text: string, targetLanguage: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Translate the following English text to the language with BCP-47 code '${targetLanguage}'. Only return the translated text, with no extra formatting or explanations.\n\nText: "${text}"`,
        });
        return response.text.trim();
    } catch (error) {
        console.error("Error in translateText:", error);
        throw new Error(`Translation failed for language '${targetLanguage}'. Please try again.`);
    }
};


let chat: Chat | null = null;

export const startChat = (detectionResult: DetectionResult, newsText: string) => {
    let systemInstruction = `You are an AI assistant helping a user understand a fake news detection result. 
    The initial analysis is provided below. Your role is to answer the user's questions about this analysis clearly and concisely.
    
    Initial News: "${newsText}"
    Verdict: ${detectionResult.verdict}
    Confidence: ${detectionResult.confidenceScore}%
    Explanation: ${detectionResult.explanation}
    Sources: ${detectionResult.sources.map(s => `[${s.title}](${s.uri})`).join(', ')}
    `;
    
    if (detectionResult.realNewsSummary) {
        systemInstruction += `\nThe Real Story: ${detectionResult.realNewsSummary}`;
    }

    chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction,
        },
    });
};

export const sendMessageToChat = async (message: string): Promise<string> => {
    if (!chat) {
        throw new Error("Chat not initialized. Call startChat first.");
    }
    try {
        const response: GenerateContentResponse = await chat.sendMessage({ message });
        return response.text;
    } catch (error) {
        console.error("Error sending chat message:", error);
        throw new Error("Failed to get a response from the chatbot. Please try again.");
    }
};