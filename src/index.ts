import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fetch from 'node-fetch';
import { OpenAI } from 'openai';

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!GOOGLE_API_KEY || !GOOGLE_CX || !OPENAI_API_KEY) {
    console.error("Missing required environment variables: GOOGLE_API_KEY, GOOGLE_CX, or OPENAI_API_KEY");
    process.exit(1);
}

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

interface FindMemeRequest {
    text: string;
    model?: string;
}

app.post('/find_meme', async (req, res) => {
    try {
        const { text, model = 'gpt-4o' } = req.body as FindMemeRequest;

        if (!text) {
            return res.status(400).json({ error: 'Missing text parameter' });
        }

        console.log(`Searching for meme: "${text}" using model: ${model}`);

        // Step 1: Refine query using OpenAI
        const completion = await openai.chat.completions.create({
            model: model,
            messages: [
                {
                    role: 'system',
                    content: 'You are a meme expert. Convert the user input into a specific Google Image Search query to find the best matching meme image. Return ONLY the query string, nothing else. Do not use quotes.'
                },
                {
                    role: 'user',
                    content: text
                }
            ]
        });

        const searchQuery = completion.choices[0].message.content?.trim() || text;
        console.log(`Refined query: "${searchQuery}"`);

        // Step 2: Google Custom Search
        // Request more results to filter out non-image links
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(searchQuery)}&searchType=image&num=5&safe=off`;

        const searchResponse = await fetch(searchUrl);

        if (!searchResponse.ok) {
            throw new Error(`Google Search API failed: ${searchResponse.statusText}`);
        }

        const searchData: any = await searchResponse.json();

        if (!searchData.items || searchData.items.length === 0) {
            return res.status(404).json({ error: 'No meme found for this description.' });
        }

        let imageUrl = '';
        let imageTitle = '';
        let found = false;
        let mimeType = 'application/octet-stream'; // Initialize mimeType here

        // Try to find a valid image from the results
        for (const item of searchData.items) {
            console.log(`Checking image: ${item.link}`);
            try {
                // Quick check on extension if possible, but headers are best
                const headResponse = await fetch(item.link, {
                    method: 'HEAD',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    },
                    timeout: 5000 // 5s timeout for checks
                });

                if (headResponse.ok) {
                    const contentType = headResponse.headers.get('content-type') || '';
                    if (contentType.startsWith('image/')) {
                        imageUrl = item.link;
                        imageTitle = item.title;
                        mimeType = contentType; // Assign mimeType here
                        found = true;
                        break;
                    } else {
                        console.log(`Skipping non-image content: ${contentType}`);
                    }
                }
            } catch (e) {
                console.log(`Failed to check image ${item.link}: ${e}`);
            }
        }

        if (!found) {
            return res.status(404).json({ error: 'No valid image accessible from search results.' });
        }

        console.log(`Found valid image: ${imageUrl}`);

        // Step 3: Fetch image and convert to base64
        const imageResponse = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        if (!imageResponse.ok) {
            throw new Error(`Failed to download image: ${imageResponse.statusText}`);
        }

        mimeType = imageResponse.headers.get('content-type') || 'application/octet-stream';
        if (!mimeType.startsWith('image/')) {
            console.warn(`URL returned non-image content type: ${mimeType}`);
            // Optionally try to find another result or just error
            // For now, let's error so we know.
            throw new Error(`URL returned non-image content: ${mimeType}`);
        }

        const arrayBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString('base64');

        // Construct artifact response
        // Using a simple JSON response that the tool can display or the agent can interpret.
        // The vision plugin returns files, but here we return the content directly or a "saved" status?
        // Vision plugin: "render_preview returns base64 JPEG artifacts..."
        // So we will return a structure that looks like an artifact.

        const artifact = {
            name: `meme_${Date.now()}.${mimeType.split('/')[1] || 'img'}`,
            type: 'image',
            base64: base64Image,
            mimeType: mimeType
        };

        const responseData = {
            url: imageUrl,
            title: imageTitle,
            query: searchQuery
        };

        const result = {
            ok: true,
            tokensUsed: completion.usage?.total_tokens || 0,
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
