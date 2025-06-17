const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

const SUPABASE_URL = 'https://qkxtptourezjcitqsnvv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreHRwdG91cmV6amNpdHFzbnZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAxNTQwMzAsImV4cCI6MjA2NTczMDAzMH0.4jMdZVQIJ_mx8VDQqYL8mjsABuYc9gjLdvS4lI3PLDg';
const BUCKET_NAME = 'vioo-uploader';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded. Make sure to use the field name "file".' });
    }

    try {
        const fileBuffer = req.file.buffer;
        const originalName = req.file.originalname;
        const mimeType = req.file.mimetype;
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const { data: existingFile, error: checkError } = await supabase
            .from('file_deduplication')
            .select('file_path')
            .eq('file_hash', fileHash)
            .single();

        if (checkError && checkError.code !== 'PGRST116') throw checkError;

        if (existingFile) {
            return res.json({
                success: true,
                message: 'File already exists.',
                url: `${CUSTOM_DOMAIN}/v/${existingFile.file_path}`
            });
        }

        const fileExt = path.extname(originalName).substring(1).toLowerCase() || 'unknown';
        const randomId = Math.random().toString(36).substring(2, 8);
        const filePath = `${randomId}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(filePath, fileBuffer, { contentType: mimeType, upsert: false });

        if (uploadError) throw uploadError;

        const { error: recordError } = await supabase
            .from('file_deduplication')
            .insert({ file_hash: fileHash, file_path: filePath });
        
        if (recordError) throw recordError;

        res.status(201).json({
            success: true,
            message: 'Upload successful.',
            url: `${CUSTOM_DOMAIN}/v/${filePath}`
        });

    } catch (error) {
        console.error('API Upload Error:', error);
        res.status(500).json({ success: false, error: 'An internal server error occurred.', details: error.message });
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

        if (error && error.code !== 'PGRST116') throw error;
        
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

if (process.env.VERCEL_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
    });
}

module.exports = app;