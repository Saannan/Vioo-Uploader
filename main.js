const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

function randomCharacter(amount) {
    const letter = 'abcdefghijklmnopqrstuvwxyz';
    let results = '';
    for (let i = 0; i < amount; i++) {
        const randomIndex = Math.floor(Math.random() * letter.length);
        let randomLetters = letter[randomIndex];
        randomLetters = Math.random() < 0.5 ? randomLetters.toUpperCase() : randomLetters;
        results += randomLetters;
    }
    return results;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

const app = express();
const port = process.env.PORT || 5000;

const SUPABASE_URL = 'https://fllyfxfiwajcmkqpvabz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsbHlmeGZpd2FqY21rcXB2YWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAyNjA4NzMsImV4cCI6MjA2NTgzNjg3M30.fxav0iq1OX8iQ4IzD0pnGtOTb73E9yCf6-9v6d_Wb78';
const BUCKET_NAME = 'uploader';
const CUSTOM_DOMAIN = 'https://cdn.vioo.my.id';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/upload', (req, res) => {
    res.status(405).json({
        error: 'Method Not Allowed',
        message: 'This endpoint only accepts POST requests to upload files.'
    });
});

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        const fileBuffer = req.file.buffer;
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const uploadDate = new Date();

        const { data: existingFile, error: checkError } = await supabase
            .from('file_deduplication')
            .select('file_path')
            .eq('file_hash', fileHash)
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            throw checkError;
        }

        if (existingFile) {
            const fileUrl = `${CUSTOM_DOMAIN}/v/${existingFile.file_path}`;
            const fileDetails = {
                id: path.parse(existingFile.file_path).name,
                name: req.file.originalname,
                size: formatFileSize(req.file.size),
                mimetype: req.file.mimetype,
                extension: path.extname(existingFile.file_path).substring(1).toLowerCase(),
                url: fileUrl,
                date: formatDate(uploadDate)
            };
            return res.json({ success: true, message: 'File already exists.', data: fileDetails });
        }

        const fileExt = path.extname(req.file.originalname).substring(1).toLowerCase() || 'bin';
        const randomId = randomCharacter(6);
        const filePath = `${randomId}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(filePath, fileBuffer, {
                contentType: req.file.mimetype,
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) {
            throw uploadError;
        }

        const { error: recordError } = await supabase
            .from('file_deduplication')
            .insert({ file_hash: fileHash, file_path: filePath });

        if (recordError) {
            await supabase.storage.from(BUCKET_NAME).remove([filePath]);
            throw recordError;
        }

        const newFileUrl = `${CUSTOM_DOMAIN}/v/${filePath}`;
        const fileDetails = {
            id: randomId,
            name: req.file.originalname,
            size: formatFileSize(req.file.size),
            mimetype: req.file.mimetype,
            extension: fileExt,
            url: newFileUrl,
            date: formatDate(uploadDate)
        };
        res.status(201).json({ success: true, message: 'Upload successful!', data: fileDetails });

    } catch (err) {
        res.status(500).json({ error: 'Could not process file upload.', data: err.message });
    }
});


app.post('/check-hash', async (req, res) => {
    const { fileHash } = req.body;
    if (!fileHash) {
        return res.status(400).json({ error: 'fileHash is required' });
    }
    try {
        const { data, error } = await supabase
            .from('file_deduplication')
            .select('file_path')
            .eq('file_hash', fileHash)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        if (data) {
            res.json({ exists: true, path: data.file_path });
        } else {
            res.json({ exists: false });
        }
    } catch (err) {
        res.status(500).json({ error: 'Could not check hash', data: err.message });
    }
});

app.post('/record-upload', async (req, res) => {
    const { fileHash, filePath } = req.body;
    if (!fileHash || !filePath) {
        return res.status(400).json({ error: 'fileHash and filePath are required' });
    }
    try {
        const { error } = await supabase
            .from('file_deduplication')
            .insert({ file_hash: fileHash, file_path: filePath });
        
        if (error) throw error;

        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Could not record upload', data: err.message });
    }
});

app.get('/v/:fileName', async (req, res) => {
    const { fileName } = req.params;
    try {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .download(fileName);

        if (error) {
            return res.status(404).json({ error: 'File not found or inaccessible' });
        }

        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeTypes = {
            'txt': 'text/plain', 'html': 'text/html', 'htm': 'text/html', 'css': 'text/css', 'js': 'application/javascript', 'json': 'application/json', 'xml': 'application/xml',
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp', 'ico': 'image/x-icon',
            'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg', 'flac': 'audio/flac',
            'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime', 'avi': 'video/x-msvideo',
            'pdf': 'application/pdf',
            'zip': 'application/zip', 'rar': 'application/vnd.rar', '7z': 'application/x-7z-compressed', 'tar': 'application/x-tar',
            'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'otf': 'font/otf', 'ttf': 'font/ttf', 'woff': 'font/woff', 'woff2': 'font/woff2'
        };
        const fileExt = fileName.split('.').pop()?.toLowerCase();
        let contentType = mimeTypes[fileExt] || 'application/octet-stream';

        if (fileExt === 'html' || fileExt === 'htm') {
            contentType = 'text/plain; charset=utf-8';
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});