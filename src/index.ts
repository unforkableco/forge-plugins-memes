import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

if (!GIPHY_API_KEY) {
    console.error("Missing required environment variable: GIPHY_API_KEY");
    process.exit(1);
}

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

interface FindMemeRequest {
    args: {
        description: string;
    }
}

app.post('/find_meme', async (req, res) => {
    try {
        const { args } = req.body as FindMemeRequest;
        const { description } = args || {};

        if (!description) {
            return res.status(400).json({ error: 'Missing description parameter' });
        }

        console.log(`Searching for meme: "${description}" on Giphy`);

        // Giphy Search API
        const limit = 1;
        const rating = 'pg-13';
        const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(description)}&limit=${limit}&rating=${rating}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Giphy API failed: ${response.statusText}`);
        }

        const data: any = await response.json();

        if (!data.data || data.data.length === 0) {
            return res.status(404).json({ error: 'No meme found for this description.' });
        }

        const gif = data.data[0];
        // Use the original image or downsized depending on needs. Original is best for quality.
        const imageUrl = gif.images?.original?.url;
        const title = gif.title;

        if (!imageUrl) {
            return res.status(404).json({ error: 'No valid image URL in Giphy response.' });
        }

        console.log(`Found valid GIF: ${imageUrl}`);

        // Fetch image to return as artifact
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to download image: ${imageResponse.statusText}`);
        }

        const mimeType = imageResponse.headers.get('content-type') || 'image/gif';
        const arrayBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString('base64');

        const artifact = {
            name: `meme_${Date.now()}.gif`,
            type: 'image',
            base64: base64Image,
            mimeType: mimeType
        };

        const responseData = {
            url: imageUrl,
            title: title,
            query: description
        };

        const result = {
            ok: true,
            tokensUsed: 0,
            artifacts: [artifact],
            result: JSON.stringify(responseData)
        };

        res.json(result);

    } catch (error: any) {
        console.error('Error in /find_meme:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Meme Search Plugin listening on port ${port}`);
});
