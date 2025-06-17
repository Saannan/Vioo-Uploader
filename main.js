const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const port = 5000;

const SUPABASE_URL = 'https://qkxtptourezjcitqsnvv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreHRwdG91cmV6amNpdHFzbnZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAxNTQwMzAsImV4cCI6MjA2NTczMDAzMH0.4jMdZVQIJ_mx8VDQqYL8mjsABuYc9gjLdvS4lI3PLDg';
const BUCKET_NAME = 'vioo-uploader';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/f/:fileName', async (req, res) => {
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
            'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp',
            'pdf': 'application/pdf', 'mp4': 'video/mp4', 'mov': 'video/quicktime',
            'mp3': 'audio/mpeg', 'txt': 'text/plain', 'html': 'text/html',
            'css': 'text/css', 'js': 'application/javascript'
        };
        const fileExt = fileName.split('.').pop()?.toLowerCase();
        
        let contentType = mimeTypes[fileExt] || 'application/octet-stream';

        if (fileExt === 'html' || fileExt === 'htm') {
            contentType = 'text/plain';
        }

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);

        res.send(buffer);
    } catch (err) {
        console.error('Internal server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`The server is running on http://localhost:${port}`);
});