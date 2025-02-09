import { IgApiClient } from 'instagram-private-api';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Function to open URL in default browser
function openBrowser(url: string) {
    let command;
    switch (process.platform) {
        case 'darwin':
            command = `open "${url}"`;
            break;
        case 'win32':
            command = `start "${url}"`;
            break;
        default:
            command = `xdg-open "${url}"`;
    }
    exec(command);
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function manualLogin() {
    console.log('Starting manual Instagram login process...');
    
    // Read character file to get credentials
    const characterPath = process.argv[2] || '../characters/instagraminternAIteddy.character.json';
    const fullPath = join(__dirname, characterPath);
    const character = JSON.parse(readFileSync(fullPath, 'utf8'));
    
    const username = character.settings.secrets.INSTAGRAM_USERNAME;
    const password = character.settings.secrets.INSTAGRAM_PASSWORD;
    const sessionDir = character.settings.secrets.INSTAGRAM_SESSION_DIR || './data/instagram_sessions';

    // Create session directory if it doesn't exist
    if (!existsSync(sessionDir)) {
        mkdirSync(sessionDir, { recursive: true });
    }

    // Check for existing session
    const sessionFile = join(sessionDir, `${username}.session.json`);
    if (existsSync(sessionFile)) {
        console.log('Found existing session, attempting to restore...');
        try {
            const ig = new IgApiClient();
            const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
            await ig.state.deserialize(session);
            console.log('Session restored successfully!');
            return;
        } catch (error) {
            console.log('Could not restore session, proceeding with new login...');
            // Continue with new login
        }
    }

    const ig = new IgApiClient();
    
    // Configure as iOS device
    ig.state.generateDevice(username);
    
    // Set mobile app headers
    ig.request.defaults.headers = {
        'User-Agent': 'Instagram 278.0.0.19.115 (iPhone14,3; iOS 17_1_1; en_US; en-US; scale=3.00; 1284x2778; 477966216)',
        'Accept': '*/*',
        'Accept-Language': 'en-US',
        'Accept-Encoding': 'gzip, deflate',
        'X-IG-Capabilities': '3brTvw==',
        'X-IG-Connection-Type': 'WIFI',
        'X-IG-App-ID': '124024574287414',
        'X-IG-Device-ID': ig.state.deviceId,
        'X-IG-Android-ID': ig.state.deviceId
    };
    
    console.log(`Opening Instagram in your browser...`);
    openBrowser('https://www.instagram.com/');
    console.log('Please ensure you are logged in to Instagram in your browser.');
    console.log('Complete any security checks if prompted.');
    
    // Wait a moment for browser interaction
    await delay(5000);
    
    console.log(`\nAttempting to establish session for ${username}...`);
    
    try {
        // Process pre-login flow
        await ig.simulate.preLoginFlow();
        
        // Attempt login
        const auth = await ig.account.login(username, password);
        console.log('Login successful!');
        
        try {
            // Try post-login flow but don't fail if it errors
            await ig.simulate.postLoginFlow();
        } catch (error) {
            // Ignore post-login errors
        }
        
        // Save session data
        const serialized = await ig.state.serialize();
        writeFileSync(sessionFile, JSON.stringify(serialized));
        
        console.log(`Session saved to ${sessionFile}`);
        console.log('You can now start the agent!');
        
    } catch (error) {
        if (error.name === 'IgCheckpointError') {
            console.log('\nInstagram security checkpoint detected!');
            console.log('Please complete the security checks in your browser.');
            console.log('Once completed, run this script again.\n');
        } else if (error.name === 'IgLoginRequiredError') {
            console.log('\nLogin required. Please ensure you are logged in through the browser first.');
            console.log('Then run this script again.\n');
        } else {
            console.error('Login failed:', error);
            console.error('Error details:', error.message);
        }
    }
}

manualLogin().catch(console.error); 