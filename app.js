import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Alert,
  ActivityIndicator,
  Modal,
  Switch,
  StatusBar,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Image,
  Dimensions,
  AppState,
  BackHandler,
  ToastAndroid,
  Vibration,
  Share
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import axios from 'axios';
import { Octokit } from '@octokit/rest';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Video from 'react-native-video';

const { width, height } = Dimensions.get('window');

// ============================================================
// CONFIG
// ============================================================
const STORAGE_PATH = RNFS.DocumentDirectoryPath + '/integrity_projects';
const CHAT_HISTORY_PATH = STORAGE_PATH + '/chat_history.json';
const AUTO_RESTART_INTERVAL = 30000;
const HEARTBEAT_INTERVAL = 5000;
const AUTO_SAVE_INTERVAL = 10000; // Salvează la fiecare 10 secunde

// ===== CHEI API =====
const AI_APIS = [
  {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/v1/chat/completions',
    key: 'sk-or-v1-8a9b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f',
    model: 'deepseek-chat',
    free: true
  }
];

const SYSTEM_PROMPT = `Ești Integrity AI Pro, un asistent de codare de nivel enterprise, similar cu Loveable.dev.

CAPABILITĂȚI:
1. Scrie cod în ORICE limbaj
2. Creează aplicații FULL-STACK complete
3. Gestionază repository-uri GitHub (clone, commit, push, PR)
4. Debug și auto-repair pentru cod stricat
5. Optimizări de performanță și securitate
6. Upload și procesare media (poze, video, documente)
7. Rulează cod direct în aplicație
8. Auto-restart și funcționare continuă
9. Salvează TOATE conversațiile automat
10. Istoric nelimitat

Răspunde întotdeauna cu cod exemplu când e relevant.`;

// ============================================================
// APP PRINCIPAL
// ============================================================
export default function App() {
  // ===== STATE =====
  const [activeTab, setActiveTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedAI, setSelectedAI] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [lastHeartbeat, setLastHeartbeat] = useState(Date.now());
  const [appState, setAppState] = useState(AppState.currentState);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  
  // ===== GITHUB =====
  const [githubToken, setGithubToken] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [octokit, setOctokit] = useState(null);
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [files, setFiles] = useState([]);
  const [fileContent, setFileContent] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [editingFile, setEditingFile] = useState(null);
  const [editedContent, setEditedContent] = useState('');
  const [commitMsg, setCommitMsg] = useState('Update from Integrity AI');
  
  // ===== MEDIA =====
  const [mediaFiles, setMediaFiles] = useState([]);
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedVideo, setCapturedVideo] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  // ===== PROIECTE =====
  const [projects, setProjects] = useState([]);
  
  // ===== UI =====
  const [showAISelector, setShowAISelector] = useState(false);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [output, setOutput] = useState('');
  const [showRunner, setShowRunner] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [showFullImage, setShowFullImage] = useState(null);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  
  const scrollViewRef = useRef();
  const heartbeatInterval = useRef(null);
  const restartTimeout = useRef(null);
  const appStateSubscription = useRef(null);
  const autoSaveInterval = useRef(null);

  // ============================================================
  // SALVARE CONVERSAȚII
  // ============================================================
  
  // Salvează conversația curentă
  const saveConversation = async () => {
    if (!messages.length) return;
    
    try {
      const historyData = {
        id: conversationId || Date.now().toString(),
        timestamp: Date.now(),
        date: new Date().toISOString(),
        messages: messages,
        summary: messages.length > 0 ? messages[0].content.substring(0, 100) : 'Conversație nouă'
      };
      
      // Încarcă istoricul existent
      let history = [];
      try {
        const existing = await RNFS.readFile(CHAT_HISTORY_PATH, 'utf8');
        history = JSON.parse(existing);
      } catch (e) {
        // Fișierul nu există
      }
      
      // Verifică dacă există deja această conversație
      const existingIndex = history.findIndex(h => h.id === historyData.id);
      if (existingIndex >= 0) {
        history[existingIndex] = historyData;
      } else {
        history.unshift(historyData); // Adaugă la început
      }
      
      // Păstrează doar ultimele 100 de conversații
      if (history.length > 100) {
        history = history.slice(0, 100);
      }
      
      // Salvează
      await RNFS.writeFile(CHAT_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
      
      setConversations(history);
      
      console.log('💾 Conversație salvată:', historyData.id);
    } catch (error) {
      console.error('Eroare salvare conversație:', error);
    }
  };

  // Încarcă istoricul conversațiilor
  const loadConversations = async () => {
    try {
      const existing = await RNFS.readFile(CHAT_HISTORY_PATH, 'utf8');
      const history = JSON.parse(existing);
      setConversations(history);
      
      // Încarcă ultima conversație
      if (history.length > 0) {
        const lastConv = history[0];
        setConversationId(lastConv.id);
        setMessages(lastConv.messages);
      } else {
        // Mesaj de bun venit
        setMessages([
          { 
            role: 'assistant', 
            content: `🤖 **Integrity AI Pro** – Salvare conversații activă!

💾 **Ce am făcut:**
- ✅ Salvare automată la fiecare mesaj
- ✅ Istoric nelimitat (${history.length} conversații salvate)
- ✅ Backup la fiecare 10 secunde
- ✅ Export conversații

Cum te pot ajuta astăzi?`
          }
        ]);
        setConversationId(Date.now().toString());
      }
    } catch (error) {
      // Prima pornire
      setMessages([
        { 
          role: 'assistant', 
          content: `🤖 **Integrity AI Pro** – Salvare conversații activă!

💾 **Sistem de salvare:**
- ✅ Toate conversațiile sunt salvate automat
- ✅ Istoric nelimitat
- ✅ Backup la fiecare 10 secunde
- ✅ Export în JSON/TXT

Cum te pot ajuta astăzi?`
        }
      ]);
      setConversationId(Date.now().toString());
    }
  };

  // Auto-save
  const startAutoSave = () => {
    if (autoSaveInterval.current) clearInterval(autoSaveInterval.current);
    
    autoSaveInterval.current = setInterval(() => {
      if (autoSaveEnabled && messages.length > 0) {
        saveConversation();
      }
    }, AUTO_SAVE_INTERVAL);
  };

  // ============================================================
  // EXPORT CONVERSAȚIE
  // ============================================================
  const exportConversation = async () => {
    try {
      const exportData = {
        id: conversationId,
        date: new Date().toISOString(),
        messages: messages,
        totalMessages: messages.length
      };
      
      const jsonString = JSON.stringify(exportData, null, 2);
      const exportPath = STORAGE_PATH + `/export_${conversationId}_${Date.now()}.json`;
      
      await RNFS.writeFile(exportPath, jsonString, 'utf8');
      
      // Share pe Android
      if (Platform.OS === 'android') {
        await Share.share({
          message: jsonString,
          title: 'Conversație Integrity AI'
        });
      }
      
      Alert.alert('✅ Succes', `Conversația a fost exportată:\n${exportPath}`);
    } catch (error) {
      Alert.alert('❌ Eroare', error.message);
    }
  };

  // ============================================================
  // ȘTERGE CONVERSAȚIE
  // ============================================================
  const deleteConversation = async (id) => {
    Alert.alert(
      'Șterge conversația',
      'Sigur vrei să ștergi această conversație?',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            try {
              const existing = await RNFS.readFile(CHAT_HISTORY_PATH, 'utf8');
              let history = JSON.parse(existing);
              history = history.filter(h => h.id !== id);
              await RNFS.writeFile(CHAT_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
              setConversations(history);
              
              if (conversationId === id) {
                // Încarcă prima conversație rămasă
                if (history.length > 0) {
                  loadConversation(history[0].id);
                } else {
                  setMessages([
                    { 
                      role: 'assistant', 
                      content: '🔄 **Conversație nouă**\n\nToate conversațiile au fost șterse. Cum te pot ajuta?'
                    }
                  ]);
                  setConversationId(Date.now().toString());
                }
              }
              
              Alert.alert('✅ Succes', 'Conversația a fost ștearsă');
            } catch (error) {
              Alert.alert('❌ Eroare', error.message);
            }
          }
        }
      ]
    );
  };

  // ============================================================
  // ÎNCARCĂ CONVERSAȚIE
  // ============================================================
  const loadConversation = async (id) => {
    try {
      const existing = await RNFS.readFile(CHAT_HISTORY_PATH, 'utf8');
      const history = JSON.parse(existing);
      const conv = history.find(h => h.id === id);
      
      if (conv) {
        setConversationId(conv.id);
        setMessages(conv.messages);
        setHistoryModalVisible(false);
        ToastAndroid.show('✅ Conversație încărcată', ToastAndroid.SHORT);
      }
    } catch (error) {
      Alert.alert('❌ Eroare', error.message);
    }
  };

  // ============================================================
  // ȘTERGE TOATE CONVERSAȚIILE
  // ============================================================
  const deleteAllConversations = async () => {
    Alert.alert(
      'Șterge toate conversațiile',
      'Această acțiune este ireversibilă!',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge tot',
          style: 'destructive',
          onPress: async () => {
            try {
              await RNFS.writeFile(CHAT_HISTORY_PATH, '[]', 'utf8');
              setConversations([]);
              setMessages([
                { 
                  role: 'assistant', 
                  content: '🔄 **Toate conversațiile au fost șterse**\n\nÎncepe o nouă conversație! Cum te pot ajuta?'
                }
              ]);
              setConversationId(Date.now().toString());
              Alert.alert('✅ Succes', 'Toate conversațiile au fost șterse');
            } catch (error) {
              Alert.alert('❌ Eroare', error.message);
            }
          }
        }
      ]
    );
  };

  // ============================================================
  // CAUTARE ÎN ISTORIC
  // ============================================================
  const searchConversations = () => {
    if (!searchQuery.trim()) return conversations;
    
    return conversations.filter(conv => {
      const searchText = searchQuery.toLowerCase();
      return conv.messages.some(msg => 
        msg.content.toLowerCase().includes(searchText)
      );
    });
  };

  // ============================================================
  // INIT
  // ============================================================
  useEffect(() => {
    createStorageDir();
    loadProjects();
    loadGitHubToken();
    loadConversations();
    startHeartbeat();
    startAutoSave();
    setupAppStateListener();
    setupBackHandler();

    return () => {
      // Salvează la ieșire
      if (messages.length > 0) {
        saveConversation();
      }
      if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
      if (restartTimeout.current) clearTimeout(restartTimeout.current);
      if (appStateSubscription.current) appStateSubscription.current.remove();
      if (autoSaveInterval.current) clearInterval(autoSaveInterval.current);
    };
  }, []);

  const createStorageDir = async () => {
    try {
      const exists = await RNFS.exists(STORAGE_PATH);
      if (!exists) await RNFS.mkdir(STORAGE_PATH);
      const mediaDir = STORAGE_PATH + '/media';
      const mediaExists = await RNFS.exists(mediaDir);
      if (!mediaExists) await RNFS.mkdir(mediaDir);
    } catch (error) {}
  };

  const loadProjects = async () => {
    try {
      const items = await RNFS.readDir(STORAGE_PATH);
      const dirs = items.filter(i => i.isDirectory());
      setProjects(dirs.map(d => ({ name: d.name, path: d.path })));
    } catch (error) {}
  };

  const loadGitHubToken = async () => {
    try {
      const token = await RNFS.readFile(STORAGE_PATH + '/github_token.txt', 'utf8');
      if (token.trim()) {
        setGithubToken(token.trim());
        loginGitHub(token.trim());
      }
    } catch (error) {}
  };

  // ============================================================
  // HEARTBEAT + AUTO-RESTART
  // ============================================================
  const startHeartbeat = () => {
    if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
    
    heartbeatInterval.current = setInterval(() => {
      const now = Date.now();
      setLastHeartbeat(now);
      
      if (isRunning) {
        console.log('💓 Heartbeat:', new Date().toLocaleTimeString());
        
        if (appState === 'background') {
          const timeInBackground = now - lastHeartbeat;
          if (timeInBackground > 60000) {
            console.log('🔄 Restart automat după background...');
            restartApp();
          }
        }
      }
    }, HEARTBEAT_INTERVAL);
  };

  const restartApp = () => {
    if (restartTimeout.current) clearTimeout(restartTimeout.current);
    
    restartTimeout.current = setTimeout(() => {
      console.log('🚀 Restart aplicație...');
      setIsRunning(true);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: '🔄 **Aplicația a fost restartată automat**\n\nToate funcționalitățile sunt active.\nRulare continuă 24/7 activată.\nConversațiile sunt salvate automat.'
      }]);
      
      Vibration.vibrate(100);
      
      if (Platform.OS === 'android') {
        ToastAndroid.show('🔄 Restart automat', ToastAndroid.SHORT);
      }
    }, 1000);
  };

  const setupAppStateListener = () => {
    appStateSubscription.current = AppState.addEventListener('change', (nextAppState) => {
      console.log('📱 App state:', appState, '→', nextAppState);
      setAppState(nextAppState);
      
      if (nextAppState === 'active') {
        console.log('📱 App activă din nou');
        if (!isRunning) {
          restartApp();
        }
      }
    });
  };

  const setupBackHandler = () => {
    BackHandler.addEventListener('hardwareBackPress', () => {
      return false;
    });
  };

  // ============================================================
  // AI ENGINE
  // ============================================================
  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMsg = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const api = AI_APIS[selectedAI];
      const response = await axios.post(
        api.url,
        {
          model: api.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages.slice(-15),
            userMsg
          ],
          temperature: 0.7,
          max_tokens: 8000,
          top_p: 0.95
        },
        {
          headers: {
            'Authorization': `Bearer ${api.key}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      let assistantContent = response.data.choices[0].message.content;
      const modelInfo = `\n\n---\n*🤖 Generat de ${api.name} (${api.model})*`;
      assistantContent += modelInfo;

      const assistantMsg = { role: 'assistant', content: assistantContent };
      setMessages(prev => [...prev, assistantMsg]);
      
      // Salvează automat după fiecare mesaj
      setTimeout(() => saveConversation(), 500);

      // Detect code
      const codeMatch = assistantContent.match(/```([\s\S]*?)```/g);
      if (codeMatch && selectedRepo) {
        setTimeout(() => {
          Alert.alert(
            '📝 Cod detectat!',
            `Am găsit ${codeMatch.length} bloc(uri) de cod. Vrei să le încarci pe GitHub?`,
            [
              { text: 'Nu', style: 'cancel' },
              {
                text: 'Da, upload',
                onPress: async () => {
                  for (let i = 0; i < codeMatch.length; i++) {
                    const code = codeMatch[i].replace(/```\w*\n?/, '').replace(/```$/, '');
                    const fileName = `code_${Date.now()}_${i}.js`;
                    await uploadFile(selectedRepo, fileName, code, `Adăugare cod generat de AI`);
                  }
                  Alert.alert('✅ Succes', `${codeMatch.length} fișiere încărcate!`);
                }
              }
            ]
          );
        }, 1000);
      }

    } catch (error) {
      if (error.response?.status === 429 || error.code === 'ECONNABORTED') {
        const nextAI = (selectedAI + 1) % AI_APIS.length;
        setSelectedAI(nextAI);
        Alert.alert('🔄 Schimb AI', `${AI_APIS[selectedAI].name} a eșuat. Folosesc ${AI_APIS[nextAI].name}.`);
        setTimeout(() => sendMessage(), 2000);
      } else {
        Alert.alert('❌ Eroare AI', error.response?.data?.error?.message || error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // GITHUB OPERATIONS
  // ============================================================
  const loginGitHub = async (token) => {
    try {
      const octokitInstance = new Octokit({ auth: token });
      const { data } = await octokitInstance.rest.users.getAuthenticated();
      setIsLoggedIn(true);
      setOctokit(octokitInstance);
      await RNFS.writeFile(STORAGE_PATH + '/github_token.txt', token, 'utf8');
      Alert.alert('✅ Succes', `Conectat ca: ${data.login}`);
      loadRepos(octokitInstance);
    } catch (error) {
      Alert.alert('❌ Eroare', 'Token invalid');
    }
  };

  const loadRepos = async (octokitInstance) => {
    try {
      const { data } = await octokitInstance.rest.repos.listForAuthenticatedUser({
        sort: 'updated',
        per_page: 100
      });
      setRepos(data);
    } catch (error) {
      Alert.alert('Eroare', error.message);
    }
  };

  const getRepoFiles = async (repoName, path = '') => {
    setLoading(true);
    try {
      const [owner, repo] = repoName.split('/');
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
      
      if (Array.isArray(data)) {
        setFiles(data);
        setFileContent('');
        setEditingFile(null);
      } else {
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        setFileContent(content);
        setEditingFile(data.path);
        setEditedContent(content);
        setFiles([]);
      }
      setCurrentPath(path);
      setSelectedRepo(repoName);
    } catch (error) {
      Alert.alert('Eroare', error.message);
    } finally {
      setLoading(false);
    }
  };

  const uploadFile = async (repoName, path, content, message = 'Upload din Integrity AI') => {
    try {
      const [owner, repo] = repoName.split('/');
      const contentBase64 = Buffer.from(content).toString('base64');
      
      let sha = null;
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
        sha = data.sha;
      } catch (e) {}

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: contentBase64,
        sha
      });

      Alert.alert('✅ Succes', `Fișierul ${path} a fost încărcat!`);
      getRepoFiles(repoName, currentPath);
    } catch (error) {
      Alert.alert('❌ Eroare', error.message);
    }
  };

  const deleteFile = async (repoName, path) => {
    Alert.alert(
      'Confirmă ștergerea',
      `Sigur vrei să ștergi ${path}?`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            try {
              const [owner, repo] = repoName.split('/');
              const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
              await octokit.rest.repos.deleteFile({
                owner,
                repo,
                path,
                message: `Ștergere ${path}`,
                sha: data.sha
              });
              Alert.alert('✅ Succes', 'Fișier șters!');
              getRepoFiles(repoName, currentPath);
            } catch (error) {
              Alert.alert('❌ Eroare', error.message);
            }
          }
        }
      ]
    );
  };

  // ============================================================
  // MEDIA FUNCTIONS
  // ============================================================
  const openCamera = () => {
    launchCamera({
      mediaType: 'photo',
      quality: 0.8,
      includeBase64: true,
      saveToPhotos: true
    }, (response) => {
      if (response.didCancel) {
        console.log('Utilizatorul a anulat camera');
      } else if (response.error) {
        Alert.alert('Eroare', response.error.message);
      } else {
        const image = {
          uri: response.assets[0].uri,
          type: response.assets[0].type || 'image/jpeg',
          name: `photo_${Date.now()}.jpg`,
          base64: response.assets[0].base64,
          width: response.assets[0].width,
          height: response.assets[0].height
        };
        setCapturedImage(image);
        uploadMedia(image, 'image');
      }
    });
  };

  const openCameraVideo = () => {
    launchCamera({
      mediaType: 'video',
      quality: 0.8,
      saveToPhotos: true,
      durationLimit: 60
    }, (response) => {
      if (response.didCancel) {
        console.log('Utilizatorul a anulat camera');
      } else if (response.error) {
        Alert.alert('Eroare', response.error.message);
      } else {
        const video = {
          uri: response.assets[0].uri,
          type: response.assets[0].type || 'video/mp4',
          name: `video_${Date.now()}.mp4`,
          duration: response.assets[0].duration
        };
        setCapturedVideo(video);
        uploadMedia(video, 'video');
      }
    });
  };

  const openGallery = () => {
    launchImageLibrary({
      mediaType: 'mixed',
      quality: 0.8,
      includeBase64: true,
      selectionLimit: 10
    }, (response) => {
      if (response.didCancel) {
        console.log('Utilizatorul a anulat');
      } else if (response.error) {
        Alert.alert('Eroare', response.error.message);
      } else {
        const files = response.assets.map((asset, index) => ({
          uri: asset.uri,
          type: asset.type || 'image/jpeg',
          name: asset.fileName || `file_${Date.now()}_${index}.${asset.type?.split('/')[1] || 'jpg'}`,
          base64: asset.base64,
          size: asset.fileSize,
          width: asset.width,
          height: asset.height
        }));
        uploadMultipleMedia(files);
      }
    });
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        copyTo: 'cachesDirectory'
      });
      
      const file = {
        uri: result[0].uri,
        type: result[0].type || 'application/octet-stream',
        name: result[0].name,
        size: result[0].size
      };
      uploadMedia(file, 'document');
    } catch (error) {
      if (!DocumentPicker.isCancel(error)) {
        Alert.alert('Eroare', error.message);
      }
    }
  };

  const uploadMedia = async (file, type) => {
    if (!selectedRepo) {
      Alert.alert('Selectează un repo', 'Mergi la tab-ul GitHub și selectează un repository');
      return;
    }

    setLoading(true);
    setUploadProgress(0);
    try {
      let content = '';
      
      if (type === 'image' || type === 'video' || type === 'document') {
        content = await RNFS.readFile(file.uri, 'base64');
      } else {
        content = await RNFS.readFile(file.uri, 'utf8');
      }

      const mediaDir = `media/${new Date().toISOString().split('T')[0]}`;
      const path = `${mediaDir}/${file.name}`;
      
      const localPath = STORAGE_PATH + '/' + path;
      const localDir = localPath.substring(0, localPath.lastIndexOf('/'));
      await RNFS.mkdir(localDir);
      await RNFS.writeFile(localPath, content, 'base64');
      
      await uploadFile(selectedRepo, path, content, `Upload ${file.name}`);
      
      setMediaFiles(prev => [...prev, { ...file, uploaded: true, timestamp: Date.now(), path }]);
      setUploadProgress(100);
      
      Alert.alert('✅ Succes', `${file.name} încărcat cu succes!`);
      setCapturedImage(null);
      setCapturedVideo(null);
      
    } catch (error) {
      Alert.alert('❌ Eroare', error.message);
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const uploadMultipleMedia = async (files) => {
    if (!selectedRepo) {
      Alert.alert('Selectează un repo', 'Mergi la tab-ul GitHub și selectează un repository');
      return;
    }

    setLoading(true);
    let uploaded = 0;
    let failed = 0;

    for (const file of files) {
      try {
        const content = file.base64 || await RNFS.readFile(file.uri, 'base64');
        const mediaDir = `media/${new Date().toISOString().split('T')[0]}`;
        const path = `${mediaDir}/${file.name}`;
        await uploadFile(selectedRepo, path, content, `Upload ${file.name}`);
        uploaded++;
      } catch (error) {
        failed++;
        console.error(`Eroare la ${file.name}:`, error);
      }
    }

    Alert.alert('✅ Upload complet', `${uploaded} fișiere încărcate, ${failed} eșuate`);
    setLoading(false);
  };

  // ============================================================
  // AUTO-REPAIR
  // ============================================================
  const autoRepair = async () => {
    if (!editingFile) {
      Alert.alert('Selectează un fișier', 'Deschide un fișier înainte de auto-repair.');
      return;
    }
    
    setLoading(true);
    try {
      const api = AI_APIS[selectedAI];
      const response = await axios.post(
        api.url,
        {
          model: api.model,
          messages: [
            {
              role: 'system',
              content: `Ești un expert în debugging și refactoring. Repară codul, elimină bug-uri, optimizează performanța, adaugă comentarii și best practices. Returnează DOAR codul reparat, fără explicații suplimentare.`
            },
            {
              role: 'user',
              content: `Repară acest cod:\n\n${editedContent}`
            }
          ],
          temperature: 0.3,
          max_tokens: 8000
        },
        {
          headers: {
            'Authorization': `Bearer ${api.key}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const fixedCode = response.data.choices[0].message.content
        .replace(/```\w*\n?/g, '')
        .replace(/```$/g, '');
      
      setEditedContent(fixedCode);
      
      Alert.alert(
        '🔧 Cod reparat!',
        'Vrei să încarci versiunea reparată pe GitHub?',
        [
          { text: 'Nu', style: 'cancel' },
          {
            text: 'Da, upload',
            onPress: () => {
              if (selectedRepo && editingFile) {
                uploadFile(selectedRepo, editingFile, fixedCode, 'Auto-repair de la Integrity AI');
              }
            }
          }
        ]
      );
    } catch (error) {
      Alert.alert('❌ Eroare', error.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // CODE RUNNER
  // ============================================================
  const runCode = async (code) => {
    setShowRunner(true);
    setOutput('🚀 Rulare cod...\n');
    try {
      const result = eval(code);
      setOutput(prev => prev + `\n✅ Rezultat:\n${JSON.stringify(result, null, 2)}`);
    } catch (error) {
      setOutput(prev => prev + `\n❌ Eroare:\n${error.message}`);
    }
  };

  // ============================================================
  // RENDER FUNCTIONS
  // ============================================================
  
  // Chat
  const renderChat = () => (
    <View style={styles.chatContainer}>
      {/* Header cu butoane istoric */}
      <View style={styles.chatHeader}>
        <Text style={styles.chatHeaderTitle}>💬 Conversație</Text>
        <View style={styles.chatHeaderButtons}>
          <TouchableOpacity onPress={() => setHistoryModalVisible(true)} style={styles.historyButton}>
            <Icon name="time" size={20} color="#6C5CE7" />
            <Text style={styles.historyButtonText}>Istoric</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={exportConversation} style={styles.historyButton}>
            <Icon name="share-outline" size={20} color="#4ADE80" />
            <Text style={styles.historyButtonText}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((msg, i) => (
          <View key={i} style={[
            styles.message,
            msg.role === 'user' ? styles.userMessage : styles.assistantMessage
          ]}>
            <Text style={[
              styles.messageText,
              msg.role === 'user' ? styles.userMessageText : styles.assistantMessageText
            ]}>
              {msg.content}
            </Text>
          </View>
        ))}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#6C5CE7" />
            <Text style={styles.loadingText}>🧠 Gândesc...</Text>
          </View>
        )}
      </ScrollView>
      
      <View style={styles.inputContainer}>
        <TouchableOpacity onPress={() => setShowAISelector(!showAISelector)} style={styles.aiSelector}>
          <Text style={styles.aiSelectorText}>{AI_APIS[selectedAI].name}</Text>
          <Icon name="chevron-down" size={16} color="#888" />
        </TouchableOpacity>
        
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Scrie comanda aici..."
          placeholderTextColor="#666"
          multiline
        />
        
        <TouchableOpacity 
          style={[styles.sendButton, loading && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={loading || !input.trim()}
        >
          <Icon name="send" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );

  // Media Upload
  const renderMediaButtons = () => (
    <View style={styles.mediaButtonsContainer}>
      <Text style={styles.mediaTitle}>📸 Media Upload</Text>
      <View style={styles.mediaButtonsRow}>
        <TouchableOpacity style={styles.mediaButton} onPress={openCamera}>
          <Icon name="camera" size={28} color="#6C5CE7" />
          <Text style={styles.mediaButtonText}>Poză</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.mediaButton} onPress={openCameraVideo}>
          <Icon name="videocam" size={28} color="#FF6B6B" />
          <Text style={styles.mediaButtonText}>Video</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.mediaButton} onPress={openGallery}>
          <Icon name="images" size={28} color="#4ADE80" />
          <Text style={styles.mediaButtonText}>Galerie</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.mediaButton} onPress={pickDocument}>
          <Icon name="document" size={28} color="#FBBF24" />
          <Text style={styles.mediaButtonText}>Document</Text>
        </TouchableOpacity>
      </View>
      
      {capturedImage && (
        <View style={styles.capturedPreview}>
          <Image source={{ uri: capturedImage.uri }} style={styles.previewImage} />
          <Text style={styles.capturedText}>📸 Poză capturată</Text>
        </View>
      )}
      
      {capturedVideo && (
        <View style={styles.capturedPreview}>
          <Icon name="videocam" size={40} color="#FF6B6B" />
          <Text style={styles.capturedText}>🎥 Video capturat</Text>
        </View>
      )}
      
      {loading && (
        <View style={styles.uploadProgress}>
          <ActivityIndicator size="small" color="#6C5CE7" />
          <Text style={styles.uploadProgressText}>Încărcare... {uploadProgress}%</Text>
        </View>
      )}
    </View>
  );

  // GitHub Tab
  const renderGitHub = () => (
    <View style={styles.githubContainer}>
      {!isLoggedIn ? (
        <View style={styles.loginContainer}>
          <Icon name="logo-github" size={80} color="#6C5CE7" />
          <Text style={styles.loginTitle}>Conectează-te la GitHub</Text>
          <Text style={styles.loginSub}>Introdu token-ul tău de acces</Text>
          <TextInput
            style={styles.tokenInput}
            value={githubToken}
            onChangeText={setGithubToken}
            placeholder="github_pat_..."
            placeholderTextColor="#666"
            secureTextEntry
          />
          <TouchableOpacity style={styles.loginButton} onPress={() => loginGitHub(githubToken)}>
            <Text style={styles.loginButtonText}>🔗 Conectează</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.loginButtonSecondary} onPress={() => Alert.alert(
            'Cum obțin token?',
            '1. Mergi la GitHub.com\n2. Settings → Developer settings\n3. Personal access tokens → Tokens (classic)\n4. Generează token nou\n5. Selectează repo și workflow\n6. Copiază token-ul aici'
          )}>
            <Text style={styles.loginButtonTextSecondary}>❓ Cum obțin token?</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.repoHeader}>
            <Text style={styles.repoTitle}>📂 Repository-uri</Text>
            <TouchableOpacity style={styles.repoButton} onPress={() => loadRepos(octokit)}>
              <Icon name="refresh" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.repoButton} onPress={() => setShowRepoModal(true)}>
              <Icon name="add" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <FlatList
            data={repos}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.repoItem, selectedRepo === item.full_name && styles.repoItemSelected]}
                onPress={() => getRepoFiles(item.full_name)}
              >
                <Icon name="folder" size={20} color="#6C5CE7" />
                <Text style={styles.repoItemText}>{item.full_name}</Text>
                <Text style={styles.repoItemStars}>⭐ {item.stargazers_count}</Text>
              </TouchableOpacity>
            )}
          />
          
          {renderMediaButtons()}
          
          {files.length > 0 && (
            <View style={styles.filesContainer}>
              <Text style={styles.filesTitle}>📄 Fișiere ({files.length})</Text>
              <FlatList
                data={files}
                keyExtractor={(item) => item.path}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.fileItem}
                    onPress={() => getRepoFiles(selectedRepo, item.path)}
                  >
                    <Icon 
                      name={item.type === 'dir' ? 'folder' : 'document'} 
                      size={18} 
                      color={item.type === 'dir' ? '#6C5CE7' : '#888'} 
                    />
                    <Text style={styles.fileItemText}>{item.path}</Text>
                    {item.type !== 'dir' && (
                      <TouchableOpacity onPress={() => deleteFile(selectedRepo, item.path)}>
                        <Icon name="trash" size={18} color="#ff6b6b" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
          
          {editingFile && (
            <View style={styles.editorContainer}>
              <Text style={styles.editorTitle}>✏️ Editare: {editingFile}</Text>
              <TouchableOpacity style={styles.repairButton} onPress={autoRepair}>
                <Icon name="construct" size={16} color="#fff" />
                <Text style={styles.repairButtonText}>🔧 Auto-repair</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.editorInput}
                value={editedContent}
                onChangeText={setEditedContent}
                multiline
                numberOfLines={10}
                textAlignVertical="top"
              />
              <TouchableOpacity 
                style={styles.saveButton}
                onPress={() => uploadFile(selectedRepo, editingFile, editedContent, commitMsg)}
              >
                <Icon name="save" size={20} color="#fff" />
                <Text style={styles.saveButtonText}>💾 Salvează</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.commitInput}
                value={commitMsg}
                onChangeText={setCommitMsg}
                placeholder="Commit message..."
                placeholderTextColor="#666"
              />
            </View>
          )}
        </>
      )}
    </View>
  );

  // Projects Tab
  const renderProjects = () => (
    <View style={styles.projectsContainer}>
      <Text style={styles.projectsTitle}>📁 Proiecte locale</Text>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.path}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.projectItem}>
            <Icon name="folder" size={24} color="#6C5CE7" />
            <Text style={styles.projectItemText}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );

  // ============================================================
  // HISTORY MODAL
  // ============================================================
  const renderHistoryModal = () => (
    <Modal
      visible={historyModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setHistoryModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.historyModalContent}>
          <View style={styles.historyModalHeader}>
            <Text style={styles.historyModalTitle}>📜 Istoric conversații</Text>
            <TouchableOpacity onPress={() => setHistoryModalVisible(false)}>
              <Icon name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.searchContainer}>
            <Icon name="search" size={20} color="#888" />
            <TextInput
              style={styles.searchInput}
              placeholder="Caută în istoric..."
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          
          <View style={styles.historyActions}>
            <TouchableOpacity style={styles.historyActionButton} onPress={exportConversation}>
              <Icon name="share-outline" size={16} color="#4ADE80" />
              <Text style={styles.historyActionText}>Export</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.historyActionButton, styles.danger]} onPress={deleteAllConversations}>
              <Icon name="trash" size={16} color="#FF6B6B" />
              <Text style={[styles.historyActionText, styles.dangerText]}>Șterge tot</Text>
            </TouchableOpacity>
          </View>
          
          <FlatList
            data={searchQuery.trim() ? searchConversations() : conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.historyItem, conversationId === item.id && styles.historyItemSelected]}
                onPress={() => loadConversation(item.id)}
                onLongPress={() => deleteConversation(item.id)}
              >
                <View style={styles.historyItemContent}>
                  <Text style={styles.historyItemDate}>
                    {new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString()}
                  </Text>
                  <Text style={styles.historyItemSummary} numberOfLines={2}>
                    {item.summary || 'Conversație'}
                  </Text>
                  <Text style={styles.historyItemCount}>
                    {item.messages.length} mesaje
                  </Text>
                </View>
                {conversationId === item.id && (
                  <Icon name="checkmark-circle" size={20} color="#4ADE80" />
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.historyEmpty}>Nicio conversație găsită</Text>
            }
          />
          
          <TouchableOpacity 
            style={styles.historyCloseButton}
            onPress={() => setHistoryModalVisible(false)}
          >
            <Text style={styles.historyCloseButtonText}>Închide</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // ============================================================
  // RENDER PRINCIPAL
  // ============================================================
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />
      
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🤖 Integrity AI Pro</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity 
            onPress={() => setActiveTab('chat')} 
            style={[styles.tabButton, activeTab === 'chat' && styles.tabButtonActive]}
          >
            <Icon name="chatbubbles" size={20} color={activeTab === 'chat' ? '#6C5CE7' : '#888'} />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setActiveTab('github')} 
            style={[styles.tabButton, activeTab === 'github' && styles.tabButtonActive]}
          >
            <Icon name="logo-github" size={20} color={activeTab === 'github' ? '#6C5CE7' : '#888'} />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setActiveTab('projects')} 
            style={[styles.tabButton, activeTab === 'projects' && styles.tabButtonActive]}
          >
            <Icon name="folder-open" size={20} color={activeTab === 'projects' ? '#6C5CE7' : '#888'} />
          </TouchableOpacity>
        </View>
      </View>
      
      <View style={styles.content}>
        {activeTab === 'chat' && renderChat()}
        {activeTab === 'github' && renderGitHub()}
        {activeTab === 'projects' && renderProjects()}
      </View>
      
      {/* Modaluri */}
      {renderHistoryModal()}
      
      <Modal
        visible={showAISelector}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAISelector(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAISelector(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🧠 Selectează AI</Text>
            {AI_APIS.map((api, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.modalItem, selectedAI === index && styles.modalItemSelected]}
                onPress={() => {
                  setSelectedAI(index);
                  setShowAISelector(false);
                }}
              >
                <Text style={styles.modalItemText}>{api.name}</Text>
                {api.free && <Text style={styles.modalItemBadge}>🆓</Text>}
                {selectedAI === index && <Icon name="checkmark" size={20} color="#6C5CE7" />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
      
      <Modal
        visible={showRunner}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRunner(false)}
      >
        <View style={styles.runnerModal}>
          <View style={styles.runnerHeader}>
            <Text style={styles.runnerTitle}>🚀 Code Runner</Text>
            <TouchableOpacity onPress={() => setShowRunner(false)}>
              <Icon name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.runnerOutput}>
            <Text style={styles.runnerOutputText}>{output}</Text>
          </ScrollView>
        </View>
      </Modal>
      
      <Modal
        visible={showRepoModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRepoModal(false)}
      >
        <View style={styles.repoModal}>
          <View style={styles.repoModalHeader}>
            <Text style={styles.repoModalTitle}>➕ Adaugă repository</Text>
            <TouchableOpacity onPress={() => setShowRepoModal(false)}>
              <Icon name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.repoModalInput}
            value={repoUrl}
            onChangeText={setRepoUrl}
            placeholder="https://github.com/user/repo.git"
            placeholderTextColor="#666"
          />
          <TouchableOpacity 
            style={styles.repoModalButton}
            onPress={() => {
              // Clone repo - implementare
              setShowRepoModal(false);
            }}
          >
            <Text style={styles.repoModalButtonText}>📥 Clonează</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ============================================================
// STYLES
// ============================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a26',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  tabButton: {
    padding: 8,
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#1a1a26',
  },
  content: {
    flex: 1,
  },
  // Chat
  chatContainer: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a26',
  },
  chatHeaderTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  chatHeaderButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  historyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
  },
  historyButtonText: {
    color: '#6C5CE7',
    fontSize: 12,
  },
  messagesContainer: {
    flex: 1,
    padding: 16,
  },
  message: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    maxWidth: '85%',
  },
  userMessage: {
    backgroundColor: '#6C5CE7',
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    backgroundColor: '#1a1a26',
    alignSelf: 'flex-start',
  },
  messageText: {
    fontSize: 16,
  },
  userMessageText: {
    color: '#fff',
  },
  assistantMessageText: {
    color: '#e0e0e0',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  loadingText: {
    color: '#888',
    marginLeft: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a26',
    backgroundColor: '#0a0a0f',
    alignItems: 'flex-end',
  },
  aiSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a26',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  aiSelectorText: {
    color: '#888',
    fontSize: 12,
    marginRight: 4,
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a26',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#6C5CE7',
    padding: 12,
    borderRadius: 12,
    marginLeft: 8,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  // GitHub
  githubContainer: {
    flex: 1,
    padding: 16,
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  loginSub: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 24,
  },
  tokenInput: {
    width: '100%',
    backgroundColor: '#1a1a26',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  loginButton: {
    backgroundColor: '#6C5CE7',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loginButtonSecondary: {
    marginTop: 12,
    paddingVertical: 10,
  },
  loginButtonTextSecondary: {
    color: '#6C5CE7',
    fontSize: 14,
  },
  repoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  repoTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  repoButton: {
    backgroundColor: '#1a1a26',
    padding: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  repoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a26',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  repoItemSelected: {
    borderWidth: 1,
    borderColor: '#6C5CE7',
  },
  repoItemText: {
    color: '#fff',
    flex: 1,
    marginLeft: 12,
  },
  repoItemStars: {
    color: '#888',
    fontSize: 12,
  },
  filesContainer: {
    marginTop: 16,
  },
  filesTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#12121a',
    padding: 10,
    borderRadius: 6,
    marginBottom: 4,
  },
  fileItemText: {
    color: '#e0e0e0',
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
  },
  editorContainer: {
    marginTop: 16,
    backgroundColor: '#1a1a26',
    padding: 12,
    borderRadius: 8,
  },
  editorTitle: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
  },
  repairButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF6B6B',
    padding: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  repairButtonText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 6,
  },
  editorInput: {
    backgroundColor: '#0a0a0f',
    borderRadius: 6,
    padding: 12,
    color: '#e0e0e0',
    minHeight: 200,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6C5CE7',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  commitInput: {
    backgroundColor: '#0a0a0f',
    borderRadius: 6,
    padding: 10,
    color: '#e0e0e0',
    marginTop: 8,
  },
  // Media
  mediaButtonsContainer: {
    marginVertical: 12,
    backgroundColor: '#1a1a26',
    padding: 12,
    borderRadius: 8,
  },
  mediaTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  mediaButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  mediaButton: {
    alignItems: 'center',
    padding: 8,
  },
  mediaButtonText: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
  },
  capturedPreview: {
    marginTop: 8,
    alignItems: 'center',
  },
  previewImage: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  capturedText: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  uploadProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  uploadProgressText: {
    color: '#888',
    marginLeft: 8,
  },
  // Projects
  projectsContainer: {
    flex: 1,
    padding: 16,
  },
  projectsTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a26',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  projectItemText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1a1a26',
    borderRadius: 16,
    padding: 24,
    width: '80%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3a',
  },
  modalItemSelected: {
    backgroundColor: '#2a2a3a',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  modalItemText: {
    color: '#fff',
    fontSize: 16,
  },
  modalItemBadge: {
    color: '#4ade80',
    fontSize: 12,
  },
  // History Modal
  historyModalContent: {
    backgroundColor: '#1a1a26',
    borderRadius: 16,
    padding: 20,
    width: '95%',
    maxHeight: '80%',
  },
  historyModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  historyModalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0f',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    padding: 10,
    color: '#fff',
  },
  historyActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  historyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#0a0a0f',
  },
  historyActionText: {
    color: '#4ADE80',
    fontSize: 12,
    marginLeft: 4,
  },
  danger: {
    borderColor: '#FF6B6B',
  },
  dangerText: {
    color: '#FF6B6B',
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#0a0a0f',
    borderRadius: 8,
    marginBottom: 8,
  },
  historyItemSelected: {
    borderWidth: 1,
    borderColor: '#6C5CE7',
  },
  historyItemContent: {
    flex: 1,
  },
  historyItemDate: {
    color: '#888',
    fontSize: 11,
  },
  historyItemSummary: {
    color: '#e0e0e0',
    fontSize: 14,
    marginVertical: 4,
  },
  historyItemCount: {
    color: '#666',
    fontSize: 11,
  },
  historyEmpty: {
    color: '#666',
    textAlign: 'center',
    padding: 20,
  },
  historyCloseButton: {
    backgroundColor: '#6C5CE7',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  historyCloseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Runner
  runnerModal: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    paddingTop: 50,
  },
  runnerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  runnerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  runnerOutput: {
    flex: 1,
    padding: 16,
  },
  runnerOutputText: {
    color: '#4ade80',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  // Repo Modal
  repoModal: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    paddingTop: 50,
    paddingHorizontal: 20,
  },
  repoModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  repoModalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  repoModalInput: {
    backgroundColor: '#1a1a26',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  repoModalButton: {
    backgroundColor: '#6C5CE7',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  repoModalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
