const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

function randomCharacter() {
    const letter = 'abcdefghijklmnopqrstuvwxyz';
    let results = '';
    for (let i = 0; i < 6; i++) {
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
    return `${day}/${month} ${year}`;
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
        
        const { data: existingFile, error: checkError } = await supabase
            .from('files')
            .select('*')
            .eq('file_hash', fileHash)
            .single();

        if (checkError && checkError.code !== 'PGRST116') {
            throw checkError;
        }

        if (existingFile) {
            const fileDetails = {
                id: existingFile.file_id,
                name: existingFile.original_name,
                size: formatFileSize(existingFile.size_bytes),
                mimetype: existingFile.mimetype,
                extension: path.extname(existingFile.file_path).substring(1).toLowerCase(),
                url: `${CUSTOM_DOMAIN}/v/${existingFile.file_path}`,
                is_private: existingFile.is_private,
                expires_at: existingFile.expires_at,
                date: formatDate(new Date(existingFile.created_at))
            };
            return res.json({ success: true, message: 'File already exists.', data: fileDetails });
        }

        const fileExt = path.extname(req.file.originalname).substring(1).toLowerCase() || 'bin';
        const randomId = randomCharacter();
        const filePath = `${randomId}.${fileExt}`;
        const uploadDate = new Date();

        const { error: uploadError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(filePath, fileBuffer, { contentType: req.file.mimetype, cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        const { data: newRecord, error: recordError } = await supabase
            .from('files')
            .insert({
                file_id: randomId,
                file_path: filePath,
                file_hash: fileHash,
                original_name: req.file.originalname,
                mimetype: req.file.mimetype,
                size_bytes: req.file.size,
                is_private: false,
                expires_at: null,
                created_at: uploadDate
            })
            .select()
            .single();

        if (recordError) {
            await supabase.storage.from(BUCKET_NAME).remove([filePath]);
            throw recordError;
        }

        const fileDetails = {
            id: newRecord.file_id,
            name: newRecord.original_name,
            size: formatFileSize(newRecord.size_bytes),
            mimetype: newRecord.mimetype,
            extension: fileExt,
            url: `${CUSTOM_DOMAIN}/v/${newRecord.file_path}`,
            is_private: newRecord.is_private,
            expires_at: newRecord.expires_at,
            date: formatDate(new Date(newRecord.created_at))
        };
        res.status(201).json({ success: true, message: 'Upload successful!', data: fileDetails });

    } catch (err) {
        res.status(500).json({ error: 'Could not process file upload.', data: err.message });
    }
});

app.post('/api/file/:id/manage', async (req, res) => {
    const { id } = req.params;
    const { is_private, expires_at } = req.body;
    
    try {
        const { data, error } = await supabase
            .from('files')
            .update({ is_private, expires_at })
            .eq('file_id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'File not found.' });
        
        res.json({ success: true, message: 'File updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Could not update file.', data: err.message });
    }
});

app.delete('/api/file/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { data: file, error: fetchError } = await supabase
            .from('files')
            .select('file_path')
            .eq('file_id', id)
            .single();

        if (fetchError || !file) throw new Error('File not found in database.');
        
        const { error: storageError } = await supabase.storage
            .from(BUCKET_NAME)
            .remove([file.file_path]);

        if (storageError) throw new Error('Failed to delete file from storage.');

        const { error: dbError } = await supabase
            .from('files')
            .delete()
            .eq('file_id', id);
        
        if (dbError) throw new Error('Failed to delete file record from database.');

        res.json({ success: true, message: 'File deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Could not delete file.', data: err.message });
    }
});

app.get('/v/:fileName', async (req, res) => {
    const { fileName } = req.params;
    try {
        const { data: file, error: dbError } = await supabase
            .from('files')
            .select('is_private, expires_at')
            .eq('file_path', fileName)
            .single();

        if (dbError || !file) {
            return res.status(404).send('File not found.');
        }

        if (file.is_private) {
            return res.status(403).send('This file is private.');
        }

        if (file.expires_at && new Date(file.expires_at) < new Date()) {
            return res.status(410).send('This file has expired and is no longer available.');
        }
        
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