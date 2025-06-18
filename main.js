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
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
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
        message: 'Only POST request to upload files.'
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
                id: path.parse(existingFile.file_path).name,
                name: existingFile.original_name,
                size: formatFileSize(existingFile.size_bytes),
                mimetype: existingFile.mimetype,
                extension: path.extname(existingFile.file_path).substring(1).toLowerCase(),
                url: `${CUSTOM_DOMAIN}/v/${existingFile.file_path}`,
                is_private: existingFile.is_private,
                expires_at: existingFile.expires_at ? formatDate(new Date(existingFile.expires_at)) : 'Permanent',
                date: formatDate(new Date(existingFile.created_at))
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

        const newFileData = {
            file_path: filePath,
            file_hash: fileHash,
            original_name: req.file.originalname,
            mimetype: req.file.mimetype,
            size_bytes: req.file.size
        };

        const { data: insertedFile, error: recordError } = await supabase
            .from('files')
            .insert(newFileData)
            .select()
            .single();

        if (recordError) {
            await supabase.storage.from(BUCKET_NAME).remove([filePath]);
            throw recordError;
        }

        const fileDetails = {
            id: randomId,
            name: insertedFile.original_name,
            size: formatFileSize(insertedFile.size_bytes),
            mimetype: insertedFile.mimetype,
            extension: fileExt,
            url: `${CUSTOM_DOMAIN}/v/${filePath}`,
            is_private: insertedFile.is_private,
            expires_at: 'Permanent',
            date: formatDate(new Date(insertedFile.created_at))
        };
        res.status(201).json({ success: true, message: 'Upload successful!', data: fileDetails });

    } catch (err) {
        res.status(500).json({ error: 'Could not process file upload.', data: err.message });
    }
});

app.get('/v/:fileName', async (req, res) => {
    const { fileName } = req.params;
    try {
        const { data: fileData, error: dbError } = await supabase
            .from('files')
            .select('is_private, expires_at')
            .eq('file_path', fileName)
            .single();

        if (dbError || !fileData) {
            return res.status(404).send('File not found.');
        }

        if (fileData.is_private) {
            return res.status(403).send('This file is private.');
        }

        if (fileData.expires_at && new Date(fileData.expires_at) < new Date()) {
            return res.status(410).send('This file has expired and is no longer available.');
        }

        const { data, error: downloadError } = await supabase.storage
            .from(BUCKET_NAME)
            .download(fileName);

        if (downloadError) {
            return res.status(404).send('File not found in storage.');
        }
        
        const fileExt = fileName.split('.').pop()?.toLowerCase();
        const mimeTypes = { 'html': 'text/plain', 'htm': 'text/plain' };
        const contentType = mimeTypes[fileExt] || data.type || 'application/octet-stream';
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', data.size);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        data.arrayBuffer().then(buffer => res.send(Buffer.from(buffer)));

    } catch (err) {
        res.status(500).send('Internal server error.');
    }
});

app.post('/file/update', async (req, res) => {
    const { id, extension, is_private, expires_at } = req.body;
    if (!id || !extension) {
        return res.status(400).json({ error: 'File ID and extension are required.' });
    }

    try {
        const filePath = `${id}.${extension}`;
        const updateData = {};
        if (typeof is_private === 'boolean') {
            updateData.is_private = is_private;
        }
        if (expires_at) {
            updateData.expires_at = expires_at === 'permanent' ? null : new Date(expires_at);
        }

        const { error } = await supabase
            .from('files')
            .update(updateData)
            .eq('file_path', filePath);

        if (error) throw error;
        res.json({ success: true, message: 'File updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Could not update file.', data: err.message });
    }
});

app.post('/file/delete', async (req, res) => {
    const { id, extension } = req.body;
     if (!id || !extension) {
        return res.status(400).json({ error: 'File ID and extension are required.' });
    }

    try {
        const filePath = `${id}.${extension}`;
        const { error: storageError } = await supabase.storage
            .from(BUCKET_NAME)
            .remove([filePath]);
        if (storageError) throw storageError;

        const { error: dbError } = await supabase
            .from('files')
            .delete()
            .eq('file_path', filePath);
        if (dbError) throw dbError;

        res.json({ success: true, message: 'File deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Could not delete file.', data: err.message });
    }
});


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});