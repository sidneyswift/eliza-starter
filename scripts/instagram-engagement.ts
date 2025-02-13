import { IgApiClient } from 'instagram-private-api';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants for rate limiting
const DAILY_LIMITS = {
    FOLLOWS: 150,
    LIKES: 300,
    COMMENTS: 100
};

const DELAY_RANGES = {
    MIN: 2000,  // 2 seconds
    MAX: 5000   // 5 seconds
};

// Comment templates
const COMMENT_TEMPLATES = {
    PERFORMANCE: [
        "That high note in {song} 🎯",
        "The energy at {venue} was unreal!",
        "Been replaying this performance 🔥"
    ],
    FAN_SUPPORT: [
        "Amazing cover! Those runs 👏",
        "You captured his style perfectly",
        "Love your take on {song}"
    ],
    COMMUNITY: [
        "Which show are you attending?",
        "Favorite song from the new album?",
        "Who else got tickets for {venue}?"
    ]
};

// Hashtags to monitor
const HASHTAGS = {
    PRIMARY: ['TeddySwims', 'TeddySwimsFans', 'TeddyArmy', 'TeddySwimsConcert', 'TeddySwimsCover'],
    SECONDARY: ['SoulMusic', 'RnB', 'AtlantaMusic', 'SoulSinger', 'MusicCommunity']
};

async function delay(min = DELAY_RANGES.MIN, max = DELAY_RANGES.MAX) {
    const delayTime = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delayTime));
}

class InstagramEngagement {
    private ig: IgApiClient;
    private dailyStats: {
        follows: number;
        likes: number;
        comments: number;
        startTime: Date;
    };
    private sessionFile: string;

    constructor(private username: string, private sessionDir: string) {
        this.ig = new IgApiClient();
        this.sessionFile = join(sessionDir, `${username}.session.json`);
        this.dailyStats = {
            follows: 0,
            likes: 0,
            comments: 0,
            startTime: new Date()
        };
    }

    async initialize() {
        if (!existsSync(this.sessionFile)) {
            throw new Error('No session found. Please run instagram-login.ts first.');
        }

        const session = JSON.parse(readFileSync(this.sessionFile, 'utf8'));
        await this.ig.state.deserialize(session);
        console.log('Session loaded successfully!');
    }

    private async handleRateLimit(error: any) {
        if (error.message.includes('rate') || error.message.includes('spam')) {
            console.log('Rate limit hit, waiting 5 minutes...');
            await delay(300000, 300000); // 5 minute delay
        }
    }

    private shouldResetDailyStats(): boolean {
        const now = new Date();
        const hoursSinceStart = (now.getTime() - this.dailyStats.startTime.getTime()) / (1000 * 60 * 60);
        return hoursSinceStart >= 24;
    }

    private resetDailyStatsIfNeeded() {
        if (this.shouldResetDailyStats()) {
            this.dailyStats = {
                follows: 0,
                likes: 0,
                comments: 0,
                startTime: new Date()
            };
        }
    }

    async likePost(mediaId: string): Promise<boolean> {
        this.resetDailyStatsIfNeeded();
        
        if (this.dailyStats.likes >= DAILY_LIMITS.LIKES) {
            console.log('Daily like limit reached');
            return false;
        }

        try {
            await this.ig.media.like({
                mediaId: mediaId,
                moduleInfo: {
                    module_name: 'feed_timeline'
                },
                d: 1
            });
            this.dailyStats.likes++;
            return true;
        } catch (error) {
            await this.handleRateLimit(error);
            return false;
        }
    }

    async commentOnPost(mediaId: string, text: string): Promise<boolean> {
        this.resetDailyStatsIfNeeded();

        if (this.dailyStats.comments >= DAILY_LIMITS.COMMENTS) {
            console.log('Daily comment limit reached');
            return false;
        }

        try {
            await this.ig.media.comment({
                mediaId: mediaId,
                text: text
            });
            this.dailyStats.comments++;
            return true;
        } catch (error) {
            await this.handleRateLimit(error);
            return false;
        }
    }

    async followUser(userId: string): Promise<boolean> {
        this.resetDailyStatsIfNeeded();

        if (this.dailyStats.follows >= DAILY_LIMITS.FOLLOWS) {
            console.log('Daily follow limit reached');
            return false;
        }

        try {
            await this.ig.friendship.create(userId);
            this.dailyStats.follows++;
            return true;
        } catch (error) {
            await this.handleRateLimit(error);
            return false;
        }
    }

    async processHashtag(hashtag: string) {
        try {
            const feed = this.ig.feed.tag(hashtag);
            const posts = await feed.items();
            
            console.log(`Processing #${hashtag} - Found ${posts.length} posts`);
            
            for (const post of posts) {
                // Check if post is relevant (contains Teddy Swims related content)
                const isRelevant = post.caption?.text.toLowerCase().includes('teddy') || 
                                 post.caption?.text.toLowerCase().includes('swims');
                
                if (!isRelevant) continue;

                // Like the post
                await this.likePost(post.id);
                await delay();

                // Comment if it's high quality content
                if (post.like_count > 50 || post.comment_count > 10) {
                    const template = COMMENT_TEMPLATES.PERFORMANCE[
                        Math.floor(Math.random() * COMMENT_TEMPLATES.PERFORMANCE.length)
                    ];
                    await this.commentOnPost(post.id, template.replace('{song}', 'Lose Control'));
                    await delay();
                }

                // Follow user if they're an active user
                const userInfo = await this.ig.user.info(post.user.pk);
                if (userInfo.media_count > 10 && userInfo.follower_count > 100) {
                    await this.followUser(post.user.pk.toString());
                    await delay();
                }
            }
        } catch (error) {
            console.error(`Error processing hashtag #${hashtag}:`, error.message);
            await this.handleRateLimit(error);
        }
    }

    async processTargetAccount(username: string) {
        try {
            const user = await this.ig.user.searchExact(username);
            console.log(`Processing account: ${username}`);
            
            const feed = this.ig.feed.user(user.pk);
            const posts = await feed.items();
            
            for (const post of posts.slice(0, 5)) {
                // Like the post
                await this.likePost(post.id);
                await delay();

                // Process comments
                const commentsFeed = this.ig.feed.mediaComments(post.id);
                const comments = await commentsFeed.items();
                
                for (const comment of comments) {
                    // Follow active commenters
                    if (comment.content_type === 'comment' && comment.text.length > 10) {
                        await this.followUser(comment.user_id.toString());
                        await delay();
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing account ${username}:`, error.message);
            await this.handleRateLimit(error);
        }
    }

    getDailyStats() {
        return {
            ...this.dailyStats,
            timeSinceStart: Math.floor(
                (new Date().getTime() - this.dailyStats.startTime.getTime()) / (1000 * 60 * 60)
            ) + ' hours'
        };
    }
}

async function main() {
    // Read character file to get configuration
    const characterPath = process.argv[2] || '../characters/instagraminternAIteddy.character.json';
    const fullPath = join(__dirname, characterPath);
    const character = JSON.parse(readFileSync(fullPath, 'utf8'));
    
    const username = character.settings.secrets.INSTAGRAM_USERNAME;
    const sessionDir = character.settings.secrets.INSTAGRAM_SESSION_DIR || './data/instagram_sessions';
    const targetAccounts = character.settings.secrets.INSTAGRAM_TARGET_ACCOUNTS.split(',');

    const engagement = new InstagramEngagement(username, sessionDir);
    await engagement.initialize();

    console.log('Starting engagement process...');

    while (true) {
        // Process target accounts
        for (const account of targetAccounts) {
            await engagement.processTargetAccount(account.trim());
            await delay(5000, 10000);
        }

        // Process hashtags
        for (const hashtag of [...HASHTAGS.PRIMARY, ...HASHTAGS.SECONDARY]) {
            await engagement.processHashtag(hashtag);
            await delay(5000, 10000);
        }

        // Log daily stats
        console.log('Daily Stats:', engagement.getDailyStats());

        // Wait before next cycle (30-60 minutes)
        await delay(1800000, 3600000);
    }
}

main().catch(console.error); 