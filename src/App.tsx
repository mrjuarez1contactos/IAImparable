import React, { useState, useRef, useEffect } from 'react';
import { 
    GoogleGenerativeAI, 
    HarmCategory, 
    HarmBlockThreshold,
    Part 
} from "@google/generative-ai";

// Helper function to convert a file to a base64 string
const fileToBase64 = (file: File | Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = (error) => reject(error);
    });
};

// Define la configuración de seguridad usando los Enums importados
const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];

const App: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [videoUrl, setVideoUrl] = useState<string>(''); // Nuevo estado para la URL
    const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null); // Nuevo estado para previsualización
    const [transcription, setTranscription] = useState<string>('');
    const [rewrittenContent, setRewrittenContent] = useState<string>(''); // Renombrado de businessSummary
    const [status, setStatus] = useState<string>('Por favor, selecciona un archivo de audio o pega un link de video.');
    const [isLoading, setIsLoading] = useState<boolean>(false);

    // State for summary improvements
    const [improvementInstruction, setImprovementInstruction] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioInstructionBlobRef = useRef<Blob | null>(null);

    // State for permanent instructions
    const [globalInstructions, setGlobalInstructions] = useState<string[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newInstruction, setNewInstruction] = useState('');
    const importFileInputRef = useRef<HTMLInputElement>(null);


    useEffect(() => {
        try {
            const storedInstructions = localStorage.getItem('globalInstructions');
            if (storedInstructions) {
                setGlobalInstructions(JSON.parse(storedInstructions));
            }
        } catch (error) {
            console.error("Failed to parse global instructions from localStorage", error);
        }
    }, []);

    const saveGlobalInstructions = (instructions: string[]) => {
        setGlobalInstructions(instructions);
        localStorage.setItem('globalInstructions', JSON.stringify(instructions));
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile) {
            // Limpia la URL cuando se sube un archivo
            setVideoUrl(''); 
            setFile(selectedFile);
            setTranscription('');
            setRewrittenContent('');
            setStatus(`Archivo seleccionado: ${selectedFile.name}`);

            // Previsualización de audio
            if (audioPreviewUrl) {
                URL.revokeObjectURL(audioPreviewUrl);
            }
            setAudioPreviewUrl(URL.createObjectURL(selectedFile));
        }
    };

    const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const url = event.target.value;
        setVideoUrl(url);

        // Limpia el archivo cuando se ingresa una URL
        if (url) {
            setFile(null);
            if (audioPreviewUrl) {
                URL.revokeObjectURL(audioPreviewUrl);
                setAudioPreviewUrl(null);
            }
        }
        setTranscription('');
        setRewrittenContent('');
        setStatus(url ? `URL ingresada: ${url}` : 'Por favor, selecciona un archivo de audio o pega un link de video.');
    };

    const handleTranscribe = async () => {
        if (!file && !videoUrl) {
            setStatus('Por favor, selecciona un archivo o ingresa una URL.');
            return;
        }

        setIsLoading(true);
        setStatus(`Transcribiendo...`);
        setTranscription('');
        setRewrittenContent('');

        try {
            const ai = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
            let parts: Part[] = [];
            let transcriptionSource: string = "";

            if (videoUrl) {
                // Lógica CRUCIAL: Se envía la URL como texto para que el modelo la analice y extraiga el audio/información.
                // NO se debe enviar como Base64.
                transcriptionSource = videoUrl;
                parts.push({
                    text: `Analiza el audio del video en esta URL: ${videoUrl}. Ignora cualquier texto o metadato de búsqueda. Transcribe ÚNICAMENTE el contenido hablado del video.`
                });

            } else if (file) {
                // Lógica de subida de archivo Base64
                transcriptionSource = file.name;
                const base64Audio = await fileToBase64(file);
                const audioPart: Part = {
                    inlineData: {
                        data: base64Audio,
                        mimeType: file.type,
                    },
                };
                parts.push(audioPart);
                parts.push({ text: "Transcribe este audio recording." });
            }

            const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
            
            const result = await model.generateContent({
                contents: [{ role: "user", parts: parts }],
                safetySettings: safetySettings
            });

            const response = result.response;
            
            setTranscription(response.text() ?? "");
            setStatus(`Transcripción de ${transcriptionSource} completa. Ahora puedes generar contenido alternativo.`);
        } catch (error) {
            console.error('Transcription error:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            setStatus(`Error en la transcripción: ${errorMessage}. (Si usas un link, el problema es que la web no puede acceder al audio del video).`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateRewrittenContent = async () => {
        if (!transcription) {
            setStatus('No hay transcripción para reescribir.');
            return;
        }

        setIsLoading(true);
        setStatus('Generando otra manera de decirlo...');
        setRewrittenContent('');

        try {
            const ai = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
            const permanentInstructionsText = globalInstructions.length > 0
                ? `Para este contenido, aplica estas reglas e instrucciones permanentes en todo momento: ${globalInstructions.join('. ')}`
                : '';

            const prompt = `Basado en la siguiente transcripción, genera una versión nueva, creativa y atractiva. Tu objetivo es reescribir el texto con palabras diferentes, cambiando el tono y el estilo para hacerlo ideal para redes sociales.
            
            ${permanentInstructionsText}

            Transcripción Original:
            ---
            ${transcription}
            ---
            
            Genera solo la nueva versión reescrita.`;

            const model = ai.getGenerativeModel({ model: 'gemini-2.5-pro' });

            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                safetySettings: safetySettings
            }); 
            const response = result.response;

            setRewrittenContent(response.text() ?? "");
            setStatus('Contenido alternativo generado. Puedes mejorarlo a continuación.');
        } catch (error) {
            console.error('Content generation error:', error);
            setStatus(`Error generando contenido alternativo: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleImproveSummary = async (isPermanent: boolean) => {
        if (!rewrittenContent) {
            setStatus('Primero debes generar contenido alternativo para poder mejorarlo.');
            return;
        }
        if (!improvementInstruction && !audioInstructionBlobRef.current) {
            setStatus('Por favor, escribe o graba una instrucción para la mejora.');
            return;
        }

        setIsLoading(true);
        setStatus('Aplicando mejoras al contenido alternativo...');

        try {
            const ai = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
            const instruction = improvementInstruction || 'la instrucción fue grabada por audio.';
            const permanentInstructionsText = globalInstructions.length > 0
                ? `Adicionalmente, aplica estas reglas e instrucciones permanentes en todo momento: ${globalInstructions.join('. ')}`
                : '';

            const promptParts: Part[] = [{ text: `
                Necesito que mejores el siguiente "Contenido Alternativo Actual" basándote en la "Transcripción Original" y la "Instrucción de Mejora" que te proporciono. 
                
                ${permanentInstructionsText}

                Instrucción de Mejora: "${instruction}"

                Transcripción Original:
                ---
                ${transcription}
                ---

                Contenido Alternativo Actual:
                ---
                ${rewrittenContent}
                ---

                Por favor, genera el "Nuevo Contenido Alternativo Mejorado":
            `}];

            if (audioInstructionBlobRef.current) {
                const base64Audio = await fileToBase64(audioInstructionBlobRef.current);
                promptParts.push({
                    inlineData: {
                        data: base64Audio,
                        mimeType: audioInstructionBlobRef.current.type,
                    }
                });
            }

            const model = ai.getGenerativeModel({ model: 'gemini-2.5-pro' });
            
            const result = await model.generateContent({
                contents: [{ role: "user", parts: promptParts }],
                safetySettings: safetySettings
            });
            const response = result.response;
            
            setRewrittenContent(response.text() ?? "");
            setStatus('Contenido alternativo mejorado exitosamente.');

            if (isPermanent && improvementInstruction) {
                if (!globalInstructions.includes(improvementInstruction)) {
                    saveGlobalInstructions([...globalInstructions, improvementInstruction]);
                }
            }
            setImprovementInstruction('');
            audioInstructionBlobRef.current = null;
        } catch (error) {
            console.error('Improvement error:', error);
            setStatus(`Error mejorando el contenido alternativo: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
            setStatus('Grabación finalizada. Presiona "Aplicar" para usarla.');
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorderRef.current = new MediaRecorder(stream);
                audioChunksRef.current = [];
                mediaRecorderRef.current.ondataavailable = (event) => audioChunksRef.current.push(event.data);
                mediaRecorderRef.current.onstop = () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    audioInstructionBlobRef.current = audioBlob;
                    stream.getTracks().forEach(track => track.stop());
                };
                mediaRecorderRef.current.start();
                setIsRecording(true);
                setStatus('Grabando instrucciones de audio... Presiona de nuevo para parar.');
            } catch (error) {
                console.error("Error accessing microphone:", error);
                setStatus("No se pudo acceder al micrófono. Por favor, verifica los permisos.");
            }
        }
    };

    const handleGenerateDocument = () => {
        if (!transcription || !rewrittenContent) {
            setStatus("Faltan datos para generar el documento.");
            return;
        }
        
        const sourceName = file ? file.name : (videoUrl || "URL de Video/Audio");

        const docContent = `
=========================================
REGISTRO DE CONTENIDO
=========================================

Fuente Original: ${sourceName}
Fecha de Procesamiento: ${new Date().toLocaleString()}

-----------------------------------------
1. TRANSCRIPCIÓN BASE
-----------------------------------------

${transcription}

-----------------------------------------
2. OTRA MANERA DE DECIRLO (Contenido Alternativo)
-----------------------------------------

${rewrittenContent}
        `;
    
        const blob = new Blob([docContent.trim()], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const baseFilename = sourceName.split('.').slice(0, -1).join('.') || sourceName;
        link.download = `Contenido_${baseFilename}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setStatus("Documento generado y descargado.");
    };

    const handleExportInstructions = () => {
        if (globalInstructions.length === 0) {
            alert("No hay mejoras permanentes para exportar.");
            return;
        }
        const content = globalInstructions.join('\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'instrucciones-permanentes.txt';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleImportInstructions = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            const lines = text.split('\n').filter(line => line.trim() !== '');
            saveGlobalInstructions(lines);
            alert(`${lines.length} mejoras importadas correctamente.`);
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset input
    };
    
    // Styles
    const styles: { [key: string]: React.CSSProperties } = {
        container: { fontFamily: 'sans-serif', backgroundColor: '#f0f2f5', minHeight: '100vh', padding: '2rem' },
        header: { textAlign: 'center', marginBottom: '1rem', color: '#1c1e21' },
        card: { backgroundColor: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', marginBottom: '1.5rem' },
        button: { backgroundColor: '#1877f2', color: 'white', border: 'none', padding: '12px 20px', borderRadius: '6px', fontSize: '16px', cursor: 'pointer', margin: '0.5rem 0', display: 'inline-block', transition: 'background-color 0.3s' },
        buttonDisabled: { backgroundColor: '#a0bdf5', cursor: 'not-allowed' },
        textarea: { width: '100%', minHeight: '150px', padding: '10px', borderRadius: '6px', border: '1px solid #dddfe2', fontSize: '14px', boxSizing: 'border-box', marginTop: '1rem' },
        status: { textAlign: 'center', margin: '1.5rem 0', color: isLoading ? '#1877f2' : '#606770', fontWeight: 'bold' },
        modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
        modalContent: { backgroundColor: 'white', padding: '2rem', borderRadius: '8px', width: '90%', maxWidth: '600px', maxHeight: '80vh', overflowY: 'auto' },
        modalInput: { width: 'calc(100% - 100px)', padding: '10px', borderRadius: '6px', border: '1px solid #dddfe2' },
        modalButton: { padding: '10px', marginLeft: '10px' },
        instructionItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid #eee', color: '#1c1e21' },
        deleteButton: { backgroundColor: '#fa3e3e', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' },
        filenameDisplay: { fontWeight: 'bold', marginBottom: '1rem', color: '#606770', padding: '8px 12px', backgroundColor: '#f0f2f5', borderRadius: '6px', border: '1px solid #dddfe2' }
    };

    return (
        <div style={styles.container}>
            <div style={{maxWidth: '800px', margin: '0 auto'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                    <h1 style={{...styles.header, marginBottom: 0, textAlign: 'left'}}>Transcriptor para Creadores</h1>
                    <button style={styles.button} onClick={() => setIsModalOpen(true)}>Instrucciones Permanentes</button>
                </div>

                <div style={styles.card}>
                    <h2>1. Fuente de Audio/Video</h2>
                    <p>Pega el link de Video (TikTok, YouTube, Instagram) o sube un archivo.</p>
                    <input 
                        type="url" 
                        placeholder="Pega aquí la URL del video..."
                        value={videoUrl}
                        onChange={handleUrlChange}
                        style={{...styles.modalInput, marginBottom: '1rem', width: '100%'}}
                    />
                    <p style={{textAlign: 'center', margin: '1rem 0', fontWeight: 'bold', color: '#606770'}}>— O —</p>
                    <input type="file" accept="audio/*" onChange={handleFileChange} style={{marginTop: '0.5rem'}} />
                    
                    <button onClick={handleTranscribe} disabled={(!file && !videoUrl) || isLoading} style={{...styles.button, ...( (!file && !videoUrl) || isLoading ? styles.buttonDisabled : {}), display: 'block', marginTop: '1.5rem' }}>
                        {isLoading ? 'Procesando...' : 'Transcribir y Extraer Contenido'}
                    </button>
                </div>
                
                <p style={styles.status}>{status}</p>

                {transcription && (
                    <div style={styles.card}>
                        <h2>2. Transcripción Base</h2>
                        {file && <p style={styles.filenameDisplay}>Archivo: {file.name}</p>}
                        {videoUrl && <p style={styles.filenameDisplay}>URL: {videoUrl}</p>}
                        
                        {audioPreviewUrl && (
                            <div style={{marginBottom: '1rem'}}>
                                <p style={{fontWeight: 'bold', color: '#1c1e21'}}>Previsualización de Audio:</p>
                                <audio controls src={audioPreviewUrl} style={{width: '100%'}} />
                            </div>
                        )}

                        <textarea style={styles.textarea} value={transcription} readOnly />
                        
                        {!rewrittenContent && (
                            <button onClick={handleGenerateRewrittenContent} disabled={isLoading} style={{...styles.button, ...(isLoading ? styles.buttonDisabled : {})}}>
                                {isLoading ? 'Generando...' : 'Generar Otra Manera de Decirlo'}
                            </button>
                        )}
                    </div>
                )}

                {rewrittenContent && (
                    <div style={styles.card}>
                        <h2>3. Otra Manera de Decirlo</h2>
                        {file && <p style={styles.filenameDisplay}>Archivo: {file.name}</p>}
                        {videoUrl && <p style={styles.filenameDisplay}>URL: {videoUrl}</p>}
                        <textarea 
                            style={styles.textarea} 
                            value={rewrittenContent}
                            onChange={(e) => setRewrittenContent(e.target.value)}
                        />
                        <div style={{marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1.5rem'}}>
                            <h3>Mejorar Contenido Alternativo</h3>
                            <p>Proporciona una instrucción para refinar el contenido anterior.</p>
                            <textarea
                                style={{...styles.textarea, minHeight: '80px'}}
                                placeholder="Ej: 'El tono debe ser más humorístico' o 'Incluye un llamado a la acción al final'"
                                value={improvementInstruction}
                                onChange={(e) => setImprovementInstruction(e.target.value)}
                            />
                            <button onClick={toggleRecording} style={{...styles.button, backgroundColor: isRecording ? '#fa3e3e' : '#42b72a'}}>
                                {isRecording ? 'Detener Grabación' : 'Grabar Instrucciones'}
                            </button>
                            <div style={{marginTop: '1rem'}}>
                                <button onClick={() => handleImproveSummary(false)} disabled={isLoading} style={{...styles.button, ...(isLoading ? styles.buttonDisabled : {})}}>
                                    Aplicar Mejora Temporal
                                </button>
                                <button onClick={() => handleImproveSummary(true)} disabled={isLoading || !improvementInstruction} style={{...styles.button, ...(isLoading || !improvementInstruction ? styles.buttonDisabled : {}), marginLeft: '1rem', backgroundColor: '#36a420'}}>
                                    Aplicar y Guardar Mejora
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {(transcription || rewrittenContent) && (
                    <div style={styles.card}>
                        <h2>4. Exportar</h2>
                        <p>Genera un archivo .txt con la transcripción y el contenido alternativo.</p>
                        <button onClick={handleGenerateDocument} style={styles.button}>
                            Generar Documento
                        </button>
                    </div>
                )}

                 {isModalOpen && (
                    <div style={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
                        <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                            <h2>Instrucciones Permanentes</h2>
                            <p>Estas reglas se aplicarán a TODO el contenido alternativo futuro.</p>
                            
                            <div style={{ display: 'flex', gap: '1rem', margin: '1rem 0', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
                                <input
                                    type="file"
                                    ref={importFileInputRef}
                                    onChange={handleImportInstructions}
                                    accept=".txt"
                                    style={{ display: 'none' }}
                                />
                                <button onClick={() => importFileInputRef.current?.click()} style={{...styles.button, flex: 1, backgroundColor: '#42b72a'}}>
                                    Importar desde Archivo
                                </button>
                                <button onClick={handleExportInstructions} style={{...styles.button, flex: 1}}>
                                    Exportar a Archivo
                                </button>
                            </div>
                            
                            <div style={{ margin: '1rem 0', display: 'flex' }}>
                                <input 
                                    type="text"
                                    value={newInstruction}
                                    onChange={(e) => setNewInstruction(e.target.value)}
                                    placeholder="Añadir nueva instrucción permanente"
                                    style={styles.modalInput}
                                    onKeyPress={(e) => { if (e.key === 'Enter') {
                                        if (newInstruction && !globalInstructions.includes(newInstruction)) {
                                            saveGlobalInstructions([...globalInstructions, newInstruction]);
                                            setNewInstruction('');
                                        }
                                    }}}
                                />
                                <button 
                                    onClick={() => {
                                        if (newInstruction && !globalInstructions.includes(newInstruction)) {
                                            saveGlobalInstructions([...globalInstructions, newInstruction]);
                                            setNewInstruction('');
                                        }
                                    }}
                                    style={{...styles.button, ...styles.modalButton}}
                                >
                                    Añadir
                                </button>
                            </div>
                            <div>
                                {globalInstructions.length === 0 && <p>No hay instrucciones guardadas.</p>}
                                {globalInstructions.map((inst, index) => (
                                    <div key={index} style={styles.instructionItem}>
                                        <span style={{flex: 1, marginRight: '1rem'}}>{inst}</span>
                                        <button 
                                            onClick={() => {
                                                const updated = globalInstructions.filter((_, i) => i !== index);
                                                saveGlobalInstructions(updated);
                                            }}
                                            style={styles.deleteButton}
                                        >
                                            Eliminar
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={() => setIsModalOpen(false)} style={{...styles.button, marginTop: '1rem'}}>Cerrar</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;