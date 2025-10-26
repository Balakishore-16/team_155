import React, { useState, useRef, useEffect, useCallback } from 'react';
import { detectFakeNews, startChat, sendMessageToChat, translateText } from './services/geminiService';
import type { DetectionResult, ChatMessage } from './types';
import { MicIcon, UploadIcon, VolumeUpIcon, VolumeXIcon, BotIcon, UserIcon, SendIcon, BackIcon, LoaderIcon, XIcon, ShieldCheckIcon, AlertTriangleIcon } from './components/Icons';

type View = 'detector' | 'chat';

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
}

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

const RadialProgress: React.FC<{ score: number, verdict: string }> = ({ score, verdict }) => {
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;

    const colorClass = verdict === 'Real' ? 'stroke-green-400' : verdict === 'Fake' ? 'stroke-red-400' : 'stroke-yellow-400';
    const textColorClass = verdict === 'Real' ? 'text-green-400' : verdict === 'Fake' ? 'text-red-400' : 'text-yellow-400';

    return (
        <div className="relative w-32 h-32 flex-shrink-0">
            <svg className="w-full h-full" viewBox="0 0 120 120">
                <circle
                    className="text-slate-700"
                    strokeWidth="10"
                    stroke="currentColor"
                    fill="transparent"
                    r={radius}
                    cx="60"
                    cy="60"
                />
                <circle
                    className={`${colorClass} transition-all duration-1000 ease-out`}
                    strokeWidth="10"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    r={radius}
                    cx="60"
                    cy="60"
                    transform="rotate(-90 60 60)"
                />
            </svg>
            <div className={`absolute inset-0 flex flex-col items-center justify-center ${textColorClass}`}>
                <span className="text-3xl font-bold">{score}</span>
                <span className="text-xs font-semibold tracking-wider">SCORE</span>
            </div>
        </div>
    );
};


const App: React.FC = () => {
    const [view, setView] = useState<View>('detector');
    const [inputText, setInputText] = useState<string>('');
    const [uploadedImage, setUploadedImage] = useState<{ data: string; name: string; type: string } | null>(null);
    const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingText, setLoadingText] = useState<string>('Analyzing...');
    const [isListening, setIsListening] = useState<boolean>(false);
    const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState<string>('');
    const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        const loadVoices = () => {
            setVoices(window.speechSynthesis.getVoices());
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }, []);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatHistory]);

    useEffect(() => {
        if (!recognition) return;

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = (event: any) => {
            setError('Speech recognition failed. Check microphone permissions.');
            setIsListening(false);
        };
        recognition.onresult = (event: any) => {
            setInputText(event.results[0][0].transcript);
        };
    }, []);

    const handleDetect = useCallback(async () => {
        if (!inputText.trim() && !uploadedImage) {
            setError('Please enter some news text or upload an image to analyze.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setDetectionResult(null);
        window.speechSynthesis.cancel();
        setIsSpeaking(false);

        const loadingMessages = ['Analyzing content...', 'Verifying with web sources...', 'Finalizing verdict...'];
        let messageIndex = 0;
        setLoadingText(loadingMessages[messageIndex]);

        const intervalId = setInterval(() => {
            messageIndex = (messageIndex + 1) % loadingMessages.length;
            setLoadingText(loadingMessages[messageIndex]);
        }, 2500);

        try {
            let imagePayload;
            if (uploadedImage) {
                const base64Data = uploadedImage.data.split(',')[1];
                imagePayload = { data: base64Data, mimeType: uploadedImage.type };
            }

            const result = await detectFakeNews(inputText, imagePayload);
            
            clearInterval(intervalId);

            if (result.language && !result.language.startsWith('en')) {
                setLoadingText('Translating results...');
                const translatedExplanation = await translateText(result.explanation, result.language);
                let translatedRealNewsSummary;
                if (result.realNewsSummary) {
                    translatedRealNewsSummary = await translateText(result.realNewsSummary, result.language);
                }
                setDetectionResult({ ...result, translatedExplanation, translatedRealNewsSummary });
            } else {
                setDetectionResult(result);
            }
        } catch (err: any) {
            clearInterval(intervalId);
            setError(err.message || 'An unknown error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [inputText, uploadedImage]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setUploadedImage({
                    data: e.target?.result as string,
                    name: file.name,
                    type: file.type
                });
                setInputText(''); // Clear text when image is chosen
                setError(null);
            };
            reader.readAsDataURL(file);
        } else {
            setError('Please upload a valid image file (e.g., PNG, JPG).');
        }
    };
    
    const toggleListen = () => {
        if (!recognition) {
            setError("Speech recognition is not supported in your browser.");
            return;
        }
        if (isListening) recognition.stop();
        else {
            setInputText('');
            setUploadedImage(null);
            recognition.start();
        }
    };

    const toggleSpeakResult = () => {
        if (isSpeaking) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            return;
        }

        if (!detectionResult || voices.length === 0) return;

        const { explanation, translatedExplanation, language } = detectionResult;
        
        const handleEnd = () => setIsSpeaking(false);

        const nativeLang = language.split('-')[0];
        const nativeVoice = voices.find(v => v.lang.startsWith(nativeLang));

        let utterance: SpeechSynthesisUtterance;

        if (translatedExplanation && nativeVoice) {
            // Speak in the detected native language if a voice is available
            utterance = new SpeechSynthesisUtterance(translatedExplanation);
            utterance.voice = nativeVoice;
            utterance.lang = nativeVoice.lang;
        } else {
            // Fallback to English
            utterance = new SpeechSynthesisUtterance(explanation);
            const englishVoice = voices.find(v => v.lang.startsWith('en-US'));
            if (englishVoice) {
                utterance.voice = englishVoice;
                utterance.lang = englishVoice.lang;
            }
        }
        
        utterance.onend = handleEnd;
        utterance.onerror = () => {
            setIsSpeaking(false);
            setError(`Could not play audio for the selected language. Your browser may not support it.`);
        };
        
        setIsSpeaking(true);
        window.speechSynthesis.speak(utterance);
    };
    
    useEffect(() => {
        return () => window.speechSynthesis.cancel();
    }, []);

    const handleStartChat = () => {
        if (!detectionResult) return;
        startChat(detectionResult, inputText || 'news from an uploaded image');
        setChatHistory([]);
        setChatInput('');
        setView('chat');
    };
    
    const handleSendChatMessage = async () => {
        if (!chatInput.trim()) return;
        const newUserMessage: ChatMessage = { role: 'user', content: chatInput };
        setChatHistory(prev => [...prev, newUserMessage]);
        const currentChatInput = chatInput;
        setChatInput('');
        setIsChatLoading(true);
        try {
            const modelResponse = await sendMessageToChat(currentChatInput);
            setChatHistory(prev => [...prev, { role: 'model', content: modelResponse }]);
        } catch (err: any) {
            setChatHistory(prev => [...prev, { role: 'model', content: err.message, isError: true }]);
        } finally {
            setIsChatLoading(false);
        }
    };

    const getResultGlowClass = (verdict: string) => {
        switch (verdict) {
            case 'Real': return 'shadow-[0_0_20px_rgba(34,197,94,0.4)]';
            case 'Fake': return 'shadow-[0_0_20px_rgba(239,68,68,0.4)]';
            case 'Uncertain': return 'shadow-[0_0_20px_rgba(250,204,21,0.4)]';
            default: return '';
        }
    };
    
    const renderDetectorView = () => (
        <div className="w-full max-w-3xl mx-auto p-4 md:p-6">
            <header className="text-center mb-8">
                <div className="flex items-center justify-center gap-3">
                    <ShieldCheckIcon className="w-10 h-10 text-blue-400"/>
                    <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 tracking-tight">
                        Intelligent Fake News Detector
                    </h1>
                </div>
                <p className="text-slate-400 mt-3 text-base tracking-wide">Analyze news with AI, verify with sources, and understand the truth.</p>
            </header>
            
            <main className={`bg-slate-800/50 backdrop-blur-sm border border-slate-700/80 rounded-2xl p-6 shadow-2xl shadow-black/20 transition-all duration-300 ${isLoading ? 'opacity-50 blur-sm' : ''}`}>
                <textarea
                    value={inputText}
                    onChange={(e) => {
                        setInputText(e.target.value);
                        if (uploadedImage) setUploadedImage(null);
                    }}
                    placeholder="Enter news headline or article text here... or use your voice."
                    className="w-full h-48 p-4 bg-slate-900/70 border border-slate-700 rounded-lg text-slate-200 text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none"
                    disabled={!!uploadedImage || isLoading}
                />
                
                {uploadedImage && (
                    <div className="mt-4 p-3 bg-slate-900/70 border border-slate-700 rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <img src={uploadedImage.data} alt="Upload preview" className="w-12 h-12 rounded-md object-cover"/>
                            <span className="text-slate-300 truncate">{uploadedImage.name}</span>
                        </div>
                        <button onClick={() => setUploadedImage(null)} className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full" disabled={isLoading}>
                            <XIcon className="w-5 h-5"/>
                        </button>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row items-center justify-between mt-5 gap-4">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={toggleListen}
                            disabled={isLoading}
                            className={`p-3 rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${isListening ? 'bg-red-500 text-white ring-4 ring-red-500/50 animate-pulse' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}
                            aria-label="Use voice input"
                        >
                            <MicIcon className="w-6 h-6"/>
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/png, image/jpeg, image/webp" className="hidden" />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isLoading}
                            className="p-3 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Upload an image file"
                        >
                            <UploadIcon className="w-6 h-6"/>
                        </button>
                    </div>
                    <button 
                        onClick={handleDetect}
                        disabled={isLoading}
                        className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-bold py-3 px-10 rounded-lg transition-all duration-300 flex items-center justify-center disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed shadow-lg hover:shadow-xl hover:shadow-blue-500/40 transform hover:-translate-y-1"
                    >
                        {isLoading ? (
                            <div className="flex flex-col items-center">
                                <div className="flex items-center">
                                    <LoaderIcon className="w-6 h-6 mr-3 animate-spin" />
                                    <span>{loadingText}</span>
                                </div>
                                <div className="w-full bg-slate-600 rounded-full h-1 mt-2 overflow-hidden">
                                    <div className="bg-blue-400 h-1 rounded-full animate-progress"></div>
                                </div>
                            </div>
                        ) : 'Detect'}
                    </button>
                </div>
            </main>

            {error && (
                <div className="mt-6 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg animate-fade-in flex items-center justify-center gap-3">
                    <AlertTriangleIcon className="w-6 h-6 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            
            {detectionResult && (
                <div className={`mt-8 bg-slate-800/50 backdrop-blur-sm border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden animate-fade-in transition-shadow duration-500 ${getResultGlowClass(detectionResult.verdict)}`}>
                    <div className={`p-4 rounded-t-2xl flex items-center justify-between ${
                        detectionResult.verdict === 'Real' ? 'bg-green-500/20' : 
                        detectionResult.verdict === 'Fake' ? 'bg-red-500/20' : 'bg-yellow-500/20'
                    }`}>
                        <h2 className="text-3xl font-bold text-white">{detectionResult.verdict} News</h2>
                         {detectionResult.language && !detectionResult.language.startsWith('en') && (
                            <span className="text-sm font-semibold text-slate-300 bg-black/20 px-3 py-1 rounded-full">
                                Detected: {languageNames.of(detectionResult.language.split('-')[0])}
                            </span>
                        )}
                    </div>
                    <div className="p-6">
                        <div className="flex flex-col md:flex-row items-center gap-6 mb-6">
                            <RadialProgress score={detectionResult.confidenceScore} verdict={detectionResult.verdict} />
                            <div className="text-slate-300 text-center md:text-left">
                                <p>{detectionResult.translatedExplanation || detectionResult.explanation}</p>
                            </div>
                        </div>

                        {detectionResult.realNewsSummary && (
                            <div className="my-6 py-6 border-y border-slate-700">
                                <h3 className="text-xl font-semibold text-green-400 mb-3 flex items-center gap-2">
                                    <ShieldCheckIcon className="w-6 h-6" />
                                    The Real Story
                                </h3>
                                <p className="text-slate-300">
                                    {detectionResult.translatedRealNewsSummary || detectionResult.realNewsSummary}
                                </p>
                            </div>
                        )}
                        
                        {detectionResult.sources.length > 0 && (
                            <div className="mb-6">
                                <h3 className="text-xl font-semibold text-slate-100 mb-3">Verified Sources:</h3>
                                <ul className="space-y-2">
                                    {detectionResult.sources.slice(0, 3).map((source, index) => (
                                        <li key={index} className="bg-slate-700/50 p-3 rounded-md hover:bg-slate-700 transition-colors">
                                            <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline break-words">
                                                {source.title}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 border-t border-slate-700">
                             <button onClick={toggleSpeakResult} className="flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-6 rounded-lg transition-colors duration-200 w-full sm:w-auto">
                                {isSpeaking ? <VolumeXIcon className="w-5 h-5" /> : <VolumeUpIcon className="w-5 h-5" />}
                                {isSpeaking ? 'Stop Speaking' : 'Read Aloud'}
                            </button>
                            <button onClick={handleStartChat} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors duration-200 w-full sm:w-auto">
                                Discuss with AI Assistant
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const renderChatView = () => (
        <div className="w-full max-w-3xl mx-auto p-4 md:p-6 h-screen flex flex-col">
            <header className="flex items-center mb-4">
                <button onClick={() => setView('detector')} className="p-2 text-slate-300 hover:bg-slate-700 rounded-full mr-2">
                    <BackIcon className="w-6 h-6" />
                </button>
                <h1 className="text-2xl font-bold text-white">Chat Assistant</h1>
            </header>
            
            <div ref={chatContainerRef} className="flex-grow bg-slate-800/80 backdrop-blur-sm border border-slate-700 rounded-lg p-4 overflow-y-auto mb-4 space-y-4">
                {chatHistory.map((msg, index) => (
                    <div key={index} className={`flex items-start gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                        {msg.role === 'model' && <div className="p-2 bg-blue-500/20 rounded-full flex-shrink-0 mt-1"><BotIcon className="w-6 h-6 text-blue-400" /></div>}
                        <div className={`max-w-md p-3 rounded-lg ${
                            msg.role === 'user'
                                ? 'bg-blue-600 text-white'
                                : msg.isError
                                ? 'bg-red-900/50 text-red-300 border border-red-700/50'
                                : 'bg-slate-700 text-slate-200'
                        }`}>
                            <p className="text-sm" dangerouslySetInnerHTML={{ __html: msg.content.replace(/\n/g, '<br />') }} />
                        </div>
                        {msg.role === 'user' && <div className="p-2 bg-slate-600/50 rounded-full flex-shrink-0 mt-1"><UserIcon className="w-6 h-6 text-slate-300" /></div>}
                    </div>
                ))}
                {isChatLoading && (
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-blue-500/20 rounded-full flex-shrink-0 mt-1"><BotIcon className="w-6 h-6 text-blue-400" /></div>
                        <div className="max-w-md p-3 rounded-lg bg-slate-700 text-slate-200 flex items-center">
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s] mx-1.5"></div>
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3 bg-slate-800/80 p-2 rounded-lg border border-slate-700">
                <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && !isChatLoading && handleSendChatMessage()}
                    placeholder="Ask a follow-up question..."
                    className="flex-grow bg-transparent text-slate-200 p-2 focus:outline-none"
                />
                <button
                    onClick={handleSendChatMessage}
                    disabled={isChatLoading || !chatInput.trim()}
                    className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
                >
                    <SendIcon className="w-5 h-5"/>
                </button>
            </div>
        </div>
    );
    
    return (
        <main className="min-h-screen text-white font-sans antialiased">
            <style>{`
                .animate-fade-in {
                    animation: fadeIn 0.5s ease-in-out;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-progress {
                    animation: progress 2.5s linear infinite;
                }
                @keyframes progress {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
            `}</style>
            <div className="container mx-auto">
                {view === 'detector' ? renderDetectorView() : renderChatView()}
            </div>
        </main>
    );
};

export default App;