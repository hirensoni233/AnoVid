
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Upload, Search, Sun, Moon, X, Play, Pause, Maximize, Minimize,
  Volume2, VolumeX, Image as ImageIcon, FileText, Video,
  Trash2, Share2, MoreVertical, Eye, Clock, Calendar, MessageSquare,
  ThumbsUp, ThumbsDown, User, Hash, Flag, Heart, List, RotateCcw,
  Settings, Check, LayoutGrid, List as ListIcon, Menu, ArrowLeft,
  Filter, BarChart2, FolderHeart, Music, CornerDownRight, Edit2, Shield,
  Database, Download, UploadCloud
} from 'lucide-react';
import { openDB } from 'idb';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useDropzone } from 'react-dropzone';
import { formatDistanceToNow, format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence } from 'framer-motion';
import { useInView } from 'react-intersection-observer';

// --- Utility Functions ---
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// --- Database Layer ---
const DB_NAME = 'AnonShareDB';
const DB_VERSION = 2; // Bumped version

async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      if (!db.objectStoreNames.contains('files')) {
        const store = db.createObjectStore('files', { keyPath: 'id' });
        store.createIndex('type', 'type');
        store.createIndex('date', 'date');
        store.createIndex('likes', 'likes'); // for sorting
      } else if (oldVersion < 2) {
        // Migration for v2: ensure indexes exist if simple v1 was used
        const store = transaction.objectStore('files');
        if (!store.indexNames.contains('likes')) store.createIndex('likes', 'likes');
      }

      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('comments')) {
        const store = db.createObjectStore('comments', { keyPath: 'id' });
        store.createIndex('fileId', 'fileId');
      }
      if (!db.objectStoreNames.contains('interactions')) { // likes, bookmarks, views
        const store = db.createObjectStore('interactions', { keyPath: 'id' });
        store.createIndex('userId_fileId', ['userId', 'fileId']);
      }
      if (!db.objectStoreNames.contains('playlists')) {
        db.createObjectStore('playlists', { keyPath: 'id' });
      }
    },
  });
}

// --- Hooks ---
function useAuth() {
  const [user, setUser] = useState(null);

  const loadUser = async () => {
    let storedUser = localStorage.getItem('anon_user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    } else {
      const newUser = {
        id: uuidv4(),
        displayName: `User_${Math.floor(Math.random() * 10000)}`,
        avatarColor: `hsl(${Math.random() * 360}, 70%, 50%)`,
        createdAt: new Date().toISOString()
      };
      localStorage.setItem('anon_user', JSON.stringify(newUser));
      setUser(newUser);
      const db = await initDB();
      await db.put('users', newUser);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  const updateUser = async (updates) => {
    if (!user) return;
    const updated = { ...user, ...updates };
    localStorage.setItem('anon_user', JSON.stringify(updated));
    setUser(updated);

    const db = await initDB();
    await db.put('users', updated);

    // Optional: Update past files (expensive but consistent)
    // For this demo, we'll just update the user store.
    // In a real app, you'd index by authorId.
  };

  return { user, updateUser };
}

// --- Components ---

const Button = React.forwardRef(({ className, variant = 'default', size = 'default', ...props }, ref) => {
  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground shadow-sm',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
    link: 'text-primary underline-offset-4 hover:underline',
  };
  const sizes = {
    default: 'h-10 px-4 py-2',
    sm: 'h-9 rounded-md px-3 text-xs',
    lg: 'h-11 rounded-md px-8 text-base',
    icon: 'h-10 w-10 p-0',
  };
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
});
Button.displayName = 'Button';

const Input = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <input
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-shadow',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

// --- Advanced Video Player ---
const VideoPlayer = ({ src, poster, duration, onEnded, autoPlay }) => {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [playing, setPlaying] = useState(autoPlay || false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(true); // Start muted typically
  const [speed, setSpeed] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [theaterMode, setTheaterMode] = useState(false);
  const controlsTimeout = useRef(null);

  useEffect(() => {
    if (autoPlay && videoRef.current) {
      videoRef.current.play().catch(() => setMuted(true)); // Autoplay often requires mute
    }
  }, [autoPlay]);

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    if (playing) {
      controlsTimeout.current = setTimeout(() => setShowControls(false), 2000);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (playing) videoRef.current.pause();
      else videoRef.current.play();
      setPlaying(!playing);
    }
  };

  const skip = (amount) => {
    if (videoRef.current) videoRef.current.currentTime += amount;
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!document.activeElement.tagName.match(/INPUT|TEXTAREA/)) {
        if (e.code === 'Space' || e.code === 'k') { e.preventDefault(); togglePlay(); }
        if (e.code === 'ArrowRight') { skip(5); }
        if (e.code === 'ArrowLeft') { skip(-5); }
        if (e.code === 'KeyM') { setMuted(!muted); }
        if (e.code === 'KeyF') { toggleFullscreen(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playing, muted]);


  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative group bg-black rounded-xl overflow-hidden shadow-xl ring-1 ring-white/10",
        theaterMode ? "fixed inset-0 z-50 rounded-none w-screen h-screen" : "aspect-video"
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => playing && setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="w-full h-full object-contain"
        muted={muted}
        onTimeUpdate={() => setProgress((videoRef.current.currentTime / videoRef.current.duration) * 100)}
        onEnded={() => { setPlaying(false); setShowControls(true); if (onEnded) onEnded(); }}
        onClick={togglePlay}
        playsInline
      />

      {/* Big Play Button Overlay */}
      <AnimatePresence>
        {!playing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.2 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/30 backdrop-blur-[2px]"
          >
            <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-2xl">
              <Play className="fill-white text-transparent ml-2 w-10 h-10" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <motion.div
        animate={{ opacity: showControls ? 1 : 0 }}
        className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 py-3 pt-12 transition-opacity"
      >
        <div className="space-y-2">
          {/* Progress Bar */}
          <div className="relative group/progress h-1.5 bg-white/20 rounded-full cursor-pointer hover:h-2.5 transition-all"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              if (videoRef.current) videoRef.current.currentTime = percent * videoRef.current.duration;
            }}
          >
            <div className="absolute top-0 left-0 h-full bg-red-600 rounded-full" style={{ width: `${progress}%` }} />
            <div className="absolute top-1/2 -translate-y-1/2 -ml-1.5 w-3 h-3 bg-red-600 rounded-full scale-0 group-hover/progress:scale-100 transition-transform shadow" style={{ left: `${progress}%` }} />
          </div>

          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-4">
              <button onClick={togglePlay} className="hover:text-red-500 transition-colors">
                {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
              </button>

              <div className="flex items-center gap-2 group/vol relative">
                <button onClick={() => setMuted(!muted)}>
                  {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
                <input type="range" min="0" max="1" step="0.1" value={muted ? 0 : volume}
                  onChange={(e) => { setVolume(e.target.value); if (videoRef.current) { videoRef.current.volume = e.target.value; setMuted(false); } }}
                  className="w-0 group-hover/vol:w-24 transition-all h-1 bg-white/30 rounded-lg accent-white cursor-pointer"
                />
              </div>

              <span className="text-xs font-mono opacity-80">
                {videoRef.current ? formatDuration(videoRef.current.currentTime) : "0:00"} / {formatDuration(videoRef.current?.duration || duration)}
              </span>
            </div>

            <div className="flex items-center gap-4">
              <button onClick={() => {
                const newSpeed = speed === 1 ? 1.5 : (speed === 1.5 ? 2 : (speed === 2 ? 0.5 : 1));
                setSpeed(newSpeed);
                if (videoRef.current) videoRef.current.playbackRate = newSpeed;
              }} className="text-xs font-bold w-10 text-center hover:bg-white/20 rounded py-1 transition">{speed}x</button>

              <button onClick={() => setTheaterMode(!theaterMode)} title="Theater Mode" className="hidden sm:block hover:text-white/80 transition text-white">
                <LayoutGrid size={20} />
              </button>
              <button onClick={toggleFullscreen} className="hover:text-white/80 transition text-white">
                {document.fullscreenElement ? <Minimize size={20} /> : <Maximize size={20} />}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// --- Comment Component ---

const Comment = ({ comment, depth = 0, onReply, currentUser }) => {
  const [showReply, setShowReply] = useState(false);

  return (
    <div className={cn("flex gap-3", depth > 0 && "ml-8 border-l-2 pl-4 border-border/50")}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-sm" style={{ backgroundColor: comment.authorAvatar || '#666' }}>
        {comment.authorName[0]?.toUpperCase()}
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{comment.authorName}</span>
          <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(comment.timestamp))} ago</span>
          {comment.authorId === currentUser?.id && <span className="text-[10px] bg-primary/10 text-primary px-1 rounded">YOU</span>}
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{comment.content}</p>

        <div className="flex items-center gap-4 pt-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground gap-1">
            <ThumbsUp size={12} /> {comment.likes || 0}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground gap-1" onClick={() => setShowReply(!showReply)}>
            Reply
          </Button>
        </div>

        {showReply && (
          <form onSubmit={(e) => {
            e.preventDefault();
            onReply(comment.id, e.target.reply.value);
            e.target.reset();
            setShowReply(false);
          }} className="mt-2 flex gap-2">
            <Input name="reply" placeholder="Write a reply..." className="h-8 text-sm" autoFocus />
            <Button size="sm" className="h-8">Reply</Button>
          </form>
        )}

        {/* Nested Replies would go here recursively if fetched */}
      </div>
    </div>
  );
}

// --- Main App Component ---

function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') !== 'light');
  const { user, updateUser } = useAuth();

  // Navigation State
  const [view, setView] = useState('home'); // home, view/:id, upload, library, analytics, storage, profile/:id, settings
  const [layout, setLayout] = useState('grid'); // grid, list
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [profileId, setProfileId] = useState(null); // For viewing other profiles

  // Data State
  const [files, setFiles] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState([]); // For search users

  // Interaction State
  const [activeInteractions, setActiveInteractions] = useState({}); // Stores user's likes/bookmarks per file

  // Filter State
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sortBy, setSortBy] = useState('newest');

  // Initialization
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    fetchLibrary();
  }, []);

  useEffect(() => {
    if (!user) return;
    // Load user interactions
    initDB().then(async db => {
      const acts = await db.getAllFromIndex('interactions', 'userId_fileId', IDBKeyRange.bound([user.id, ''], [user.id, '\uffff']));
      const map = {};
      acts.forEach(a => map[a.fileId] = { ...map[a.fileId], [a.type]: true });
      setActiveInteractions(map);
    });
  }, [user]);

  // Filtering Logic
  useEffect(() => {
    let res = [...files];
    let usersRes = [...allUsers];

    // Search
    if (search) {
      const lower = search.toLowerCase();
      res = res.filter(f => f.title.toLowerCase().includes(lower) || f.tags?.some(t => t.toLowerCase().includes(lower)));
      // Filter users too if searching
      if (category === 'People') {
        // If category is people, we use a different list, handled in render usually, but let's filter here
      }
    }

    // Category
    if (category !== 'All') {
      if (category === 'Videos') res = res.filter(f => f.type.includes('video'));
      else if (category === 'Photos') res = res.filter(f => f.type === 'image');
      else if (category === 'Text') res = res.filter(f => f.type === 'text');
      else if (category === 'Favorites') res = res.filter(f => activeInteractions[f.id]?.bookmark);
      // 'People' category handled in Render
    }

    // Sort
    if (sortBy === 'newest') res.sort((a, b) => new Date(b.date) - new Date(a.date));
    else if (sortBy === 'oldest') res.sort((a, b) => new Date(a.date) - new Date(b.date));
    else if (sortBy === 'popular') res.sort((a, b) => (b.metrics?.likes || 0) - (a.metrics?.likes || 0));

    setFilteredFiles(res);
  }, [files, search, category, sortBy, activeInteractions]);


  async function fetchLibrary() {
    setLoading(true);
    const db = await initDB();
    const all = await db.getAll('files');
    const users = await db.getAll('users');
    const withMetrics = all.map(f => ({ ...f, metrics: f.metrics || { likes: 0, views: 0, comments: 0 } }));
    setFiles(withMetrics);
    setAllUsers(users);
    setLoading(false);
  }

  // --- Actions ---

  const goToProfile = (id) => {
    setProfileId(id);
    setView('profile');
    setSelectedFile(null);
  };

  const handleInteraction = async (fileId, type) => {
    if (!user) return;
    const db = await initDB();
    const existing = activeInteractions[fileId]?.[type];

    // Update Local State
    setActiveInteractions(prev => ({
      ...prev,
      [fileId]: { ...prev[fileId], [type]: !existing }
    }));

    // Update DB
    if (existing) {
      // Remove interaction
      // (Requires ID logic, simplified here by ignoring exact ID removal for demo, just re-adding/overwriting)
      // In real app, query exact interaction ID to delete.
    } else {
      await db.add('interactions', {
        id: uuidv4(),
        userId: user.id,
        fileId,
        type,
        timestamp: new Date().toISOString()
      });
    }

    // Optimize: Update aggregate count on file object immediately
    if (type === 'like') {
      const fIndex = files.findIndex(f => f.id === fileId);
      if (fIndex > -1) {
        const newFiles = [...files];
        newFiles[fIndex].metrics.likes += (existing ? -1 : 1);
        setFiles(newFiles);
        // Async update DB
        const f = newFiles[fIndex];
        db.put('files', f);
      }
    }
  };

  const handleUpload = async (newFiles) => {
    const db = await initDB();
    const processed = newFiles.map(f => ({
      ...f,
      id: uuidv4(),
      metrics: { likes: 0, views: 0, comments: 0 },
      authorId: user?.id,
      authorName: user?.displayName
    }));

    for (const f of processed) await db.add('files', f);

    fetchLibrary();
    setView('home');
  };

  const handleComment = async (fileId, content, parentId = null) => {
    if (!user || !content.trim()) return;
    const db = await initDB();
    const newComment = {
      id: uuidv4(),
      fileId,
      parentId,
      content,
      authorId: user.id,
      authorName: user.displayName,
      authorAvatar: user.avatarColor,
      timestamp: new Date().toISOString(),
      likes: 0
    };
    await db.add('comments', newComment);
    setComments(prev => [newComment, ...prev]);

    // Update file comment count
    const fIndex = files.findIndex(f => f.id === fileId);
    if (fIndex > -1) {
      const updated = [...files];
      updated[fIndex].metrics.comments += 1;
      setFiles(updated);
      db.put('files', updated[fIndex]);
    }
  };

  // --- Views ---

  if (view === 'storage') {
    return <StorageView onClose={() => setView('home')} />;
  }

  if (view === 'upload') {
    return (
      <UploadView
        onClose={() => setView('home')}
        onUpload={handleUpload}
      />
    );
  }

  if (view === 'profile' && profileId) {
    return (
      <UserProfileView
        userId={profileId}
        onClose={() => setView('home')}
        onFileClick={setSelectedFile}
        currentUser={user}
        goToProfile={goToProfile}
      />
    );
  }

  if (view === 'settings') {
    return (
      <SettingsView
        user={user}
        onUpdate={updateUser}
        onClose={() => setView('home')}
      />
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isSidebarOpen ? 240 : 70 }}
        className="border-r border-border bg-card z-20 hidden md:flex flex-col flex-shrink-0"
      >
        <div className="p-4 flex items-center gap-3 font-bold text-xl text-primary cursor-pointer border-b border-border/50 h-16" onClick={() => setView('home')}>
          <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white shrink-0 shadow-lg">
            <Play fill="currentColor" size={16} />
          </div>
          {isSidebarOpen && <span className="tracking-tight">AnonStream</span>}
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-2">
          <SidebarItem icon={<LayoutGrid />} label="Home" active={view === 'home' && category === 'All'} onClick={() => { setCategory('All'); setView('home'); }} expanded={isSidebarOpen} />
          <SidebarItem icon={<FolderHeart />} label="Favorites" active={category === 'Favorites'} onClick={() => { setCategory('Favorites'); setView('home'); }} expanded={isSidebarOpen} />
          <SidebarItem icon={<User />} label="My Profile" onClick={() => { if (user) goToProfile(user.id); }} expanded={isSidebarOpen} />
          <div className="my-4 border-t border-border/50 mx-4" />
          <SidebarItem icon={<Video />} label="Videos" active={category === 'Videos'} onClick={() => { setCategory('Videos'); setView('home'); }} expanded={isSidebarOpen} />
          <SidebarItem icon={<ImageIcon />} label="Photos" active={category === 'Photos'} onClick={() => { setCategory('Photos'); setView('home'); }} expanded={isSidebarOpen} />
          <SidebarItem icon={<FileText />} label="Articles" active={category === 'Text'} onClick={() => { setCategory('Text'); setView('home'); }} expanded={isSidebarOpen} />
          <div className="my-4 border-t border-border/50 mx-4" />
          <SidebarItem icon={<Database />} label="Data & Storage" active={view === 'storage'} onClick={() => setView('storage')} expanded={isSidebarOpen} />
        </div>

        <div className="p-4 border-t border-border/50">
          {user && isSidebarOpen ? (
            <div className="flex items-center gap-3 bg-secondary/50 p-2 rounded-lg cursor-pointer hover:bg-secondary transition-colors" onClick={() => setView('settings')}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm" style={{ backgroundColor: user.avatarColor }}>
                {user.displayName[0]}
              </div>
              <div className="overflow-hidden">
                <div className="text-sm font-medium truncate">{user.displayName}</div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Settings size={8} /> Settings</div>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 mx-auto rounded-full bg-secondary cursor-pointer" onClick={() => setView('settings')} />
          )}
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full bg-background/50 relative overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b border-border bg-background/95 backdrop-blur flex items-center px-4 gap-4 shrink-0 z-10 sticky top-0">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(!isSidebarOpen)}><Menu /></Button>
          <Button variant="ghost" size="icon" className="hidden md:flex" onClick={() => setSidebarOpen(!isSidebarOpen)}><Menu /></Button>

          <div className="flex-1 max-w-xl relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search titles, tags..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-secondary/50 border-transparent focus:bg-background transition-colors rounded-full"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setDarkMode(!darkMode)}>{darkMode ? <Sun size={20} /> : <Moon size={20} />}</Button>
            <Button onClick={() => setView('upload')} className="gap-2 rounded-full shadow-md bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 border-0">
              <Upload size={18} /> <span className="hidden sm:inline">Create</span>
            </Button>
          </div>
        </header>

        {/* Scrollable Area */}
        <main className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-secondary p-4 md:p-6 pb-20">
          {selectedFile ? (
            <FileDetailView
              file={selectedFile}
              onClose={() => setSelectedFile(null)}
              currentUser={user}
              onInteract={handleInteraction}
              interactions={activeInteractions[selectedFile.id] || {}}
              onComment={handleComment}
              allComments={comments} // Mocked for now, implies fetching
              loadComments={async (fileId) => {
                // Real fetch logic
                const db = await initDB();
                const cmts = await db.getAll('comments');
                setComments(cmts.filter(c => c.fileId === fileId));
              }}
            />
          ) : (
            <div className="space-y-6 max-w-7xl mx-auto">
              {/* Filters Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mx-2 px-2 border-b border-border/40">
                <div className="flex gap-2">
                  {['All', 'Videos', 'Photos', 'Text', 'People'].map(c => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        category === c ? "bg-foreground text-background shadow-md" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-secondary rounded-lg p-1">
                    <button onClick={() => setLayout('grid')} className={cn("p-1.5 rounded-md transition", layout === 'grid' && "bg-background shadow-sm")}><LayoutGrid size={16} /></button>
                    <button onClick={() => setLayout('list')} className={cn("p-1.5 rounded-md transition", layout === 'list' && "bg-background shadow-sm")}><ListIcon size={16} /></button>
                  </div>
                  <select
                    className="bg-transparent text-sm font-medium outline-none cursor-pointer"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="newest">Newest</option>
                    <option value="popular">Popular</option>
                    <option value="oldest">Oldest</option>
                  </select>
                </div>
              </div>

              {/* Content Grid */}
              <div className={cn(
                "grid gap-6",
                layout === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1 max-w-3xl mx-auto"
              )}>
                {category === 'People' ? (
                  allUsers.filter(u => !search || u.displayName.toLowerCase().includes(search.toLowerCase())).map(u => (
                    <div key={u.id} className="bg-card border border-border p-6 rounded-xl flex flex-col items-center gap-4 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => goToProfile(u.id)}>
                      <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-md" style={{ backgroundColor: u.avatarColor }}>
                        {u.displayName[0]}
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-lg">{u.displayName}</div>
                        <div className="text-sm text-muted-foreground">{formatDistanceToNow(new Date(u.createdAt))}</div>
                      </div>
                      <Button size="sm" variant="outline">View Profile</Button>
                    </div>
                  ))
                ) : (
                  <AnimatePresence>
                    {filteredFiles.map(file => (
                      <ContentCard
                        key={file.id}
                        file={file}
                        layout={layout}
                        onClick={() => setSelectedFile(file)}
                        onUserClick={(e) => { e.stopPropagation(); goToProfile(file.authorId); }}
                      />
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {filteredFiles.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-20 opacity-50">
                  <FolderHeart size={64} strokeWidth={1} />
                  <p className="mt-4 text-lg">No content found</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// --- Sub-Components (Clean Separation) ---

const SidebarItem = ({ icon, label, active, onClick, expanded }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-4 px-4 py-3 text-sm font-medium transition-colors relative mx-auto",
      active ? "text-primary" : "text-muted-foreground hover:bg-secondary/50",
      !expanded && "justify-center px-2"
    )}
  >
    {active && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full" />}
    <span className={cn(active && "fill-current")}>{icon}</span>
    {expanded && <span>{label}</span>}
  </button>
);

const ContentCard = ({ file, layout, onClick, onUserClick }) => {
  return (
    <motion.div
      layoutId={`card-${file.id}`}
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      className={cn(
        "group cursor-pointer bg-card border border-border rounded-xl overflow-hidden hover:shadow-xl transition-all duration-300",
        layout === 'list' ? "flex gap-4 p-4 items-start" : "flex flex-col"
      )}
    >
      <div className={cn(
        "relative bg-black/10 overflow-hidden",
        layout === 'list' ? "w-48 aspect-video rounded-lg shrink-0" : "aspect-video w-full"
      )}>
        {file.thumbnail ? (
          <img src={file.thumbnail} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-secondary/30">
            {file.type === 'text' ? <FileText size={32} /> : <ImageIcon size={32} />}
          </div>
        )}
        <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm text-white text-[10px] uppercase font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
          {file.type.includes('video') && <Play size={8} fill="currentColor" />}
          {file.type === 'text' ? 'READ' : file.type.replace('video', '').replace('image', 'IMG')}
        </div>
      </div>

      <div className={cn("flex flex-col", layout === 'grid' && "p-3")}>
        <div className="flex justify-between items-start gap-2">
          <h3 className={cn("font-bold leading-tight group-hover:text-primary transition line-clamp-2", layout === 'list' ? "text-lg" : "text-sm")}>{file.title}</h3>
          {layout === 'list' && <Button variant="ghost" size="icon" className="h-8 w-8 -mt-1"><MoreVertical size={16} /></Button>}
        </div>

        {layout === 'list' && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{file.description}</p>}

        <div className="mt-auto pt-2 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="hover:underline cursor-pointer hover:text-primary z-10" onClick={onUserClick}>{file.authorName || 'Anonymous'}</span>
            <span>•</span>
            <span>{formatDistanceToNow(new Date(file.date))} ago</span>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-4 text-xs font-medium opacity-60">
          <span className="flex items-center gap-1"><Eye size={12} /> {file.metrics?.views || 0}</span>
          <span className="flex items-center gap-1"><ThumbsUp size={12} /> {file.metrics?.likes || 0}</span>
        </div>
      </div>
    </motion.div>
  );
};

const FileDetailView = ({ file, onClose, interactions, onInteract, onComment, allComments, loadComments, currentUser, goToProfile }) => {
  const [replyText, setReplyText] = useState('');

  useEffect(() => { loadComments(file.id); }, [file]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-7xl mx-auto space-y-6">
      <Button variant="ghost" onClick={onClose} className="mb-2 pl-0 hover:pl-2 transition-all gap-1"><ArrowLeft size={16} /> Back to Feed</Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-border">
            {file.type.includes('video') ? (
              <VideoPlayer
                src={URL.createObjectURL(file.blob)}
                poster={file.thumbnail}
                duration={file.duration}
                autoPlay
              />
            ) : file.type === 'image' ? (
              <img src={URL.createObjectURL(file.blob)} className="w-full h-auto max-h-[80vh] object-contain mx-auto" />
            ) : (
              <div className="p-8 md:p-12 bg-card min-h-[50vh] prose dark:prose-invert max-w-none">
                <h1 className="text-4xl font-extrabold mb-8">{file.title}</h1>
                <div className="text-lg leading-relaxed whitespace-pre-wrap font-serif">{file.content}</div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h1 className="text-2xl md:text-3xl font-bold">{file.title}</h1>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div onClick={() => goToProfile(file.authorId)} className="cursor-pointer w-10 h-10 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-white font-bold shadow hover:scale-105 transition-transform">
                  {file.authorName?.[0] || 'A'}
                </div>
                <div>
                  <div onClick={() => goToProfile(file.authorId)} className="font-semibold cursor-pointer hover:underline">{file.authorName}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(file.date), 'MMMM d, yyyy')}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-card border border-border rounded-full p-1 pr-4 shadow-sm">
                <div className="flex items-center border-r border-border pr-2 mr-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn("rounded-l-full gap-2", interactions.like && "text-blue-500 bg-blue-500/10")}
                    onClick={() => onInteract(file.id, 'like')}
                  >
                    <ThumbsUp size={18} fill={interactions.like ? "currentColor" : "none"} /> {file.metrics.likes}
                  </Button>
                  <Button variant="ghost" size="sm" className="rounded-r-full px-2 text-muted-foreground"><ThumbsDown size={18} /></Button>
                </div>
                <Button variant="ghost" size="sm" className="gap-2" onClick={() => onInteract(file.id, 'bookmark')}>
                  <FolderHeart size={18} fill={interactions.bookmark ? "currentColor" : "none"} className={interactions.bookmark ? "text-red-500" : ""} />
                  {interactions.bookmark ? 'Saved' : 'Save'}
                </Button>
                <Button variant="ghost" size="icon"><Share2 size={18} /></Button>
                <Button variant="ghost" size="icon"><Flag size={18} /></Button>
              </div>
            </div>

            <div className="bg-card/50 rounded-xl p-4 text-sm">
              <div className="font-semibold mb-1">Description</div>
              <p className="text-muted-foreground">{file.description || "No description provided."}</p>
              <div className="flex gap-2 mt-4">
                {file.tags?.map(tag => (
                  <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-md">#{tag}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Comments Section */}
          <div className="pt-8 border-t border-border">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              {allComments.length} Comments
              <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">Polite discussion only</span>
            </h3>

            <form onSubmit={(e) => { e.preventDefault(); onComment(file.id, replyText); setReplyText(''); }} className="flex gap-4 mb-8">
              <div className="w-10 h-10 rounded-full bg-secondary shrink-0 flex items-center justify-center font-bold text-muted-foreground">{currentUser?.displayName[0]}</div>
              <div className="flex-1 space-y-2">
                <input
                  className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-2 transition-colors"
                  placeholder="Add a comment..."
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button disabled={!replyText.trim()} size="sm">Comment</Button>
                </div>
              </div>
            </form>

            <div className="space-y-6">
              {allComments.map(c => (
                <Comment key={c.id} comment={c} onReply={onComment} currentUser={currentUser} />
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar Recommendations */}
        <div className="space-y-6">
          <h3 className="font-bold text-lg">Recommended</h3>
          {/* Placeholder for recommendations - reused list view */}
          <div className="space-y-4 opacity-70">
            <div className="bg-secondary/30 rounded-lg h-24 flex items-center justify-center text-sm text-muted-foreground italic">
              Algorithm learning your taste...
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const UploadView = ({ onClose, onUpload }) => {
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  // Process files on drop
  const onDrop = async (accepted) => {
    const newFiles = await Promise.all(accepted.map(async f => {
      let type = 'unknown';
      if (f.type.startsWith('image/')) type = 'image';
      else if (f.type.startsWith('video/')) type = f.size > 50 * 1024 * 1024 ? 'long-video' : 'short-video';
      else if (f.type.startsWith('text/') || f.name.endsWith('.md') || f.name.endsWith('.txt')) type = 'text';

      // Generate thumb
      let thumb = null;
      if (type === 'image') thumb = await fileToDataURL(f);
      else if (type.includes('video')) thumb = await generateVideoThumbnail(f);

      return {
        originalFile: f,
        blob: f, // Store full blob
        title: f.name.replace(/\.[^/.]+$/, ""),
        description: '',
        tags: [],
        type,
        thumbnail: thumb,
        date: new Date().toISOString(),
        content: type === 'text' ? await f.text() : null
      };
    }));
    setFiles(prev => [...prev, ...newFiles]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const handleFinalize = async () => {
    setUploading(true);
    // Simulate network delay
    await new Promise(r => setTimeout(r, 1500));
    onUpload(files);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-card w-full max-w-4xl max-h-[90vh] rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-border flex justify-between items-center bg-muted/20">
          <div>
            <h2 className="text-2xl font-bold">Upload Studio</h2>
            <p className="text-muted-foreground text-sm">Share your creativity with the world</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {files.length === 0 ? (
            <div
              {...getRootProps()}
              className={cn(
                "h-96 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all",
                isDragActive ? "border-primary bg-primary/5 scale-[0.99]" : "border-border hover:border-primary/50 hover:bg-muted/30"
              )}
            >
              <input {...getInputProps()} />
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
                <Upload className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">Drag files to upload</h3>
              <p className="text-muted-foreground mb-6">or click to browse</p>
              <div className="flex gap-4 text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                <span>Videos</span> • <span>Photos</span> • <span>Text</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {files.map((f, i) => (
                <div key={i} className="bg-secondary/20 p-4 rounded-xl border border-border space-y-4">
                  <div className="flex gap-4">
                    <div className="w-24 h-24 bg-black rounded-lg overflow-hidden shrink-0">
                      {f.thumbnail ? <img src={f.thumbnail} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><FileText /></div>}
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input
                        value={f.title}
                        onChange={e => {
                          const updated = [...files];
                          updated[i].title = e.target.value;
                          setFiles(updated);
                        }}
                        placeholder="Title"
                        className="font-bold"
                      />
                      <textarea
                        className="w-full bg-transparent text-sm resize-none border-b border-border focus:border-primary outline-none h-16"
                        placeholder="Description..."
                        value={f.description}
                        onChange={e => {
                          const updated = [...files];
                          updated[i].description = e.target.value;
                          setFiles(updated);
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input placeholder="Tags (comma separated)" className="text-xs h-8"
                      onChange={e => {
                        const updated = [...files];
                        updated[i].tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                        setFiles(updated);
                      }}
                    />
                  </div>
                </div>
              ))}
              <div
                {...getRootProps()}
                className="border-2 border-dashed rounded-xl flex items-center justify-center min-h-[200px] cursor-pointer hover:bg-muted/30"
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Upload />
                  <span className="text-sm font-medium">Add more</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border bg-muted/20 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleFinalize} disabled={files.length === 0 || uploading} className="w-32">
            {uploading ? "Publishing..." : "Publish All"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

// --- Helpers for Thumb/File ---
const fileToDataURL = (file) => new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = e => resolve(e.target.result);
  reader.readAsDataURL(file);
});

const generateVideoThumbnail = (file) => new Promise((resolve) => {
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.currentTime = 1; // Capture at 1s
  video.onloadeddata = () => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    resolve(canvas.toDataURL());
  };
});



const StorageView = ({ onClose }) => {
  const [stats, setStats] = useState({ files: 0, size: 0, comments: 0, interactions: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    calculateStats();
  }, []);

  const calculateStats = async () => {
    setLoading(true);
    const db = await initDB();
    const files = await db.getAll('files');
    const comments = await db.count('comments');
    const interactions = await db.count('interactions');

    let totalSize = 0;
    files.forEach(f => {
      if (f.blob) totalSize += f.blob.size;
    });

    setStats({
      files: files.length,
      size: totalSize,
      comments,
      interactions
    });
    setLoading(false);
  };

  const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const handleExport = async () => {
    const db = await initDB();
    const exportData = {
      version: DB_VERSION,
      date: new Date().toISOString(),
      files: await db.getAll('files'),
      comments: await db.getAll('comments'),
      interactions: await db.getAll('interactions'),
      users: await db.getAll('users')
    };

    const metadataOnly = {
      ...exportData,
      files: exportData.files.map(f => ({ ...f, blob: null, thumbnail: null }))
    };

    const blob = new Blob([JSON.stringify(metadataOnly, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anonstream-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const handleClear = async () => {
    if (confirm("DANGER: This will delete ALL your uploaded files, comments, and interactions permanently. This cannot be undone.")) {
      const db = await initDB();
      await db.clear('files');
      await db.clear('comments');
      await db.clear('interactions');
      await db.clear('playlists');
      calculateStats();
      alert("Database cleared.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={onClose}><ArrowLeft /></Button>
        <div>
          <h2 className="text-3xl font-bold">Storage & Data</h2>
          <p className="text-muted-foreground">Manage your locally stored content</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <CardStat icon={<FileText className="text-blue-500" />} label="Total Files" value={stats.files} />
        <CardStat icon={<Database className="text-purple-500" />} label="Storage Used" value={formatBytes(stats.size)} />
        <CardStat icon={<MessageSquare className="text-green-500" />} label="Comments" value={stats.comments} />
        <CardStat icon={<Heart className="text-red-500" />} label="Interactions" value={stats.interactions} />
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-6">
        <div>
          <h3 className="text-xl font-semibold mb-2 flex items-center gap-2"><Download size={20} /> Export Metadata</h3>
          <p className="text-muted-foreground text-sm mb-4">Download a JSON file containing all your post titles, descriptions, comments, and history. (Note: Actual video/image files are skipped in this JSON backup to save space).</p>
          <Button onClick={handleExport} variant="outline" className="gap-2">Download JSON Backup</Button>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-xl font-semibold mb-2 text-destructive flex items-center gap-2"><Trash2 size={20} /> Danger Zone</h3>
          <p className="text-muted-foreground text-sm mb-4">Clear all local data. This app uses <strong>IndexedDB</strong>, so your files exist only in this browser.</p>
          <Button onClick={handleClear} variant="destructive" className="gap-2">Clear All Data</Button>
        </div>
      </div>

      <div className="bg-secondary/20 p-4 rounded-lg text-xs text-muted-foreground">
        <p><strong>Technical Info:</strong> All your files (Videos, Images) are stored as binary Blobs directly in your browser's IndexedDB system. They are never uploaded to a remote server. If you clear your browser cookies/data, this content will be lost.</p>
      </div>
    </div>
  );
};

const CardStat = ({ icon, label, value }) => (
  <div className="bg-card border border-border p-6 rounded-xl flex items-center gap-4 shadow-sm">
    <div className="p-3 bg-secondary rounded-full">{icon}</div>
    <div>
      <div className="text-sm text-muted-foreground font-medium">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  </div>
);


const UserProfileView = ({ userId, onClose, onFileClick, currentUser, goToProfile }) => {
  const [profile, setProfile] = useState(null);
  const [userFiles, setUserFiles] = useState([]);

  useEffect(() => {
    const load = async () => {
      const db = await initDB();
      let u = null;
      if (currentUser && currentUser.id === userId) {
        u = currentUser;
      } else {
        u = await db.get('users', userId);
      }

      // Fallback for mock users or if not found
      if (!u) u = { id: userId, displayName: 'Unknown User', avatarColor: '#999', createdAt: new Date().toISOString() };

      setProfile(u);

      const allFiles = await db.getAll('files');
      setUserFiles(allFiles.filter(f => f.authorId === userId).sort((a, b) => new Date(b.date) - new Date(a.date)));
    };
    load();
  }, [userId, currentUser]);

  if (!profile) return <div className="p-10 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;

  const isMe = currentUser?.id === userId;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      <Button variant="ghost" onClick={onClose} className="mb-4 pl-0 gap-2"><ArrowLeft size={16} /> Back</Button>

      <div className="relative rounded-2xl bg-secondary/30 h-48 md:h-64 mb-16 overflow-visible">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-purple-600/20 rounded-2xl" />

        <div className="absolute -bottom-12 left-8 md:left-12 flex items-end gap-6">
          <div className="w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-background text-4xl font-bold flex items-center justify-center text-white shadow-xl" style={{ backgroundColor: profile.avatarColor }}>
            {profile.displayName[0]}
          </div>
          <div className="mb-2">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              {profile.displayName}
              {isMe && <span className="text-xs bg-primary px-2 py-0.5 rounded-full text-white">YOU</span>}
            </h1>
            <p className="text-muted-foreground font-medium">Joined {formatDistanceToNow(new Date(profile.createdAt))} ago</p>
          </div>
        </div>
      </div>

      <div className="pt-8">
        <div className="flex items-center gap-4 mb-6">
          <h2 className="text-xl font-bold">Uploads ({userFiles.length})</h2>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {userFiles.map(f => (
            <ContentCard
              key={f.id}
              file={f}
              layout="grid"
              onClick={() => onFileClick(f)}
              onUserClick={(e) => { e.stopPropagation(); }} // Already on profile
            />
          ))}
          {userFiles.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground opacity-60">
              <Video size={48} className="mx-auto mb-2" />
              <p>No uploads yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SettingsView = ({ user, onUpdate, onClose }) => {
  const [name, setName] = useState(user.displayName);
  const [color, setColor] = useState(user.avatarColor);

  const handleSave = () => {
    onUpdate({ displayName: name, avatarColor: color });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl overflow-hidden p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Edit Profile</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
        </div>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white shadow-lg transition-colors duration-300" style={{ backgroundColor: color }}>
            {name?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex gap-2">
            {['#e11d48', '#d97706', '#65a30d', '#0891b2', '#2563eb', '#7c3aed', '#c026d3'].map(c => (
              <button
                key={c}
                className={cn("w-6 h-6 rounded-full border-2 transition-all", color === c ? "border-foreground scale-110" : "border-transparent opacity-70 hover:opacity-100")}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Username</label>
          <Input value={name} onChange={e => setName(e.target.value)} maxLength={20} />
          <p className="text-xs text-muted-foreground">This name will appear on all your future uploads and comments.</p>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </div>
      </div>
    </div>
  );
};

export default App;
