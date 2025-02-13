import { IgApiClient } from 'instagram-private-api';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function followCommenters() {
    console.log('Starting Instagram commenter following process...');
    
    // Read character file to get configuration
    const characterPath = process.argv[2] || '../characters/instagraminternAIteddy.character.json';
    const fullPath = join(__dirname, characterPath);
    const character = JSON.parse(readFileSync(fullPath, 'utf8'));
    
    const username = character.settings.secrets.INSTAGRAM_USERNAME;
    const sessionDir = character.settings.secrets.INSTAGRAM_SESSION_DIR || './data/instagram_sessions';
    const targetAccounts = character.settings.secrets.INSTAGRAM_TARGET_ACCOUNTS || [];
    const maxFollowsPerDay = parseInt(character.settings.secrets.INSTAGRAM_MAX_FOLLOWS_PER_DAY || '50');
    
    // Check for existing session
    const sessionFile = join(sessionDir, `${username}.session.json`);
    if (!existsSync(sessionFile)) {
        console.log('No session found. Please run instagram-login.ts first.');
        return;
    }

    const ig = new IgApiClient();
    
    try {
        // Load session
        const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
        await ig.state.deserialize(session);
        console.log('Session loaded successfully!');
        
        let followCount = 0;
        
        // Process each target account
        for (const targetAccount of targetAccounts) {
            if (followCount >= maxFollowsPerDay) {
                console.log(`Reached maximum follows per day (${maxFollowsPerDay})`);
                break;
            }
            
            try {
                // Get user info
                const user = await ig.user.searchExact(targetAccount);
                console.log(`Processing account: ${targetAccount}`);
                
                // Get recent posts
                const feed = ig.feed.user(user.pk);
                const posts = await feed.items();
                
                // Process each post's comments
                for (const post of posts.slice(0, 5)) { // Process last 5 posts
                    if (followCount >= maxFollowsPerDay) break;
                    
                    const commentsFeed = ig.feed.mediaComments(post.id);
                    const comments = await commentsFeed.items();
                    
                    console.log(`Found ${comments.length} comments on post`);
                    
                    // Process each commenter
                    for (const comment of comments) {
                        if (followCount >= maxFollowsPerDay) break;
                        
                        try {
                            // Add random delay between follows (5-15 seconds)
                            const delayTime = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
                            await delay(delayTime);
                            
                            // Follow the commenter
                            await ig.friendship.create(comment.user_id);
                            console.log(`Followed user: ${comment.user.username}`);
                            followCount++;
                            
                        } catch (error) {
                            console.log(`Error following user: ${error.message}`);
                            // If we hit a rate limit or similar error, wait longer
                            if (error.message.includes('rate') || error.message.includes('spam')) {
                                console.log('Rate limit hit, waiting 5 minutes...');
                                await delay(300000); // 5 minutes
                            }
                        }
                    }
                }
                
            } catch (error) {
                console.error(`Error processing account ${targetAccount}:`, error.message);
                continue;
            }
        }
        
        console.log(`Finished following process. Followed ${followCount} users.`);
        
    } catch (error) {
        console.error('Error during following process:', error);
        if (error.name === 'IgLoginRequiredError') {
            console.log('Session expired. Please run instagram-login.ts again.');
        }
    }
}

followCommenters().catch(console.error); 