const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

const SUPABASE_URL = 'https://qkxtptourezjcitqsnvv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreHRwdG91cmV6amNpdHFzbnZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAxNTQwMzAsImV4cCI6MjA2NTczMDAzMH0.4jMdZVQIJ_mx8VDQqYL8mjsABuYc9gjLdvS4lI3PLDg';
const BUCKET_NAME = 'vioo-uploader';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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
        res.status(500).json({ error: 'Could not check hash', details: err.message });
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
        res.status(500).json({ error: 'Could not record upload', details: err.message });
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