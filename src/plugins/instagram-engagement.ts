import { IgApiClient } from 'instagram-private-api';
import { Character, IAgentRuntime, Plugin } from '@elizaos/core';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

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

// Hashtags to monitor
const HASHTAGS = {
    PRIMARY: ['TeddySwims', 'TeddySwimsFans', 'TeddyArmy', 'TeddySwimsConcert', 'TeddySwimsCover'],
    SECONDARY: ['SoulMusic', 'RnB', 'AtlantaMusic', 'SoulSinger', 'MusicCommunity']
};

interface FanScore {
    userId: string;
    username: string;
    score: number;
    lastUpdated: Date;
    engagementHistory: {
        comments: number;
        likes: number;
        teddyMentions: number;
        postQuality: number;
    };
}

interface EngagementAnalytics {
    dailyStats: {
        date: string;
        follows: number;
        likes: number;
        comments: number;
        fanScores: number[];
        successfulEngagements: number;
        skippedEngagements: number;
    }[];
    topFans: FanScore[];
    engagementRates: {
        followBackRate: number;
        commentResponseRate: number;
        averageFanScore: number;
    };
}

async function delay(min = DELAY_RANGES.MIN, max = DELAY_RANGES.MAX) {
    const delayTime = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delayTime));
}

export class InstagramEngagementPlugin implements Plugin {
    name = 'instagram-engagement';
    description = 'Handles Instagram engagement automation with character personality';
    
    private ig: IgApiClient;
    private dailyStats: {
        follows: number;
        likes: number;
        comments: number;
        startTime: Date;
    };
    private sessionFile: string;
    private isRunning: boolean = false;
    private fanScores: Map<string, FanScore> = new Map();
    private analytics: EngagementAnalytics = {
        dailyStats: [],
        topFans: [],
        engagementRates: {
            followBackRate: 0,
            commentResponseRate: 0,
            averageFanScore: 0
        }
    };

    constructor(
        private character: Character,
        private runtime: IAgentRuntime
    ) {
        this.ig = new IgApiClient();
        const username = this.character.settings.secrets.INSTAGRAM_USERNAME;
        const sessionDir = this.character.settings.secrets.INSTAGRAM_SESSION_DIR || './data/instagram_sessions';
        this.sessionFile = join(sessionDir, `${username}.session.json`);
        this.dailyStats = {
            follows: 0,
            likes: 0,
            comments: 0,
            startTime: new Date()
        };
    }

    async start() {
        console.log('🚀 Starting Instagram Engagement Plugin...');
        if (!existsSync(this.sessionFile)) {
            console.error('❌ No Instagram session found. Please run instagram-login.ts first.');
            throw new Error('No Instagram session found. Please run instagram-login.ts first.');
        }

        try {
            await this.initialize();
            console.log('✅ Instagram plugin initialized successfully');
            console.log('👤 Logged in as:', this.character.settings.secrets.INSTAGRAM_USERNAME);
            this.startEngagementLoop();
        } catch (error) {
            console.error('❌ Failed to start Instagram plugin:', error);
            throw error;
        }
    }

    async stop() {
        this.isRunning = false;
    }

    private async initialize() {
        console.log('🔄 Initializing Instagram session...');
        const session = JSON.parse(readFileSync(this.sessionFile, 'utf8'));
        await this.ig.state.deserialize(session);
        console.log('✅ Instagram session loaded successfully!');
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

    private async generateComment(post: any, fanScore?: FanScore): Promise<string> {
        console.log('💭 Generating comment for post...');
        try {
            const prompt = `Generate a short, engaging comment (under 50 characters) for an Instagram post about Teddy Swims. Post caption: "${post.caption?.text || ''}"`;
            console.log('🤖 Using prompt:', prompt);
            
            const serverPort = parseInt(process.env.SERVER_PORT || "3000");
            console.log('🔌 Connecting to agent on port:', serverPort);
            
            const response = await fetch(
                `http://localhost:${serverPort}/${this.runtime.agentId}/message`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        text: prompt,
                        userId: "system",
                        userName: "System"
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const comment = data[0]?.text?.trim() || "Amazing! 🔥";
            console.log('✍️ Generated comment:', comment);
            return comment;
        } catch (error) {
            console.error('❌ Error generating comment:', error);
            return "Amazing! 🔥";
        }
    }

    private async countCommentResponses(mediaId: string): Promise<number> {
        try {
            const commentsFeed = this.ig.feed.mediaComments(mediaId);
            const comments = await commentsFeed.items();
            return comments.filter(comment => 
                comment.text.toLowerCase().includes('@' + this.character.name.toLowerCase())
            ).length;
        } catch (error) {
            console.error('Error counting comment responses:', error);
            return 0;
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

    async commentOnPost(mediaId: string, post: any, fanScore?: FanScore): Promise<boolean> {
        this.resetDailyStatsIfNeeded();

        if (this.dailyStats.comments >= DAILY_LIMITS.COMMENTS) {
            console.log('Daily comment limit reached');
            return false;
        }

        try {
            const comment = await this.generateComment(post, fanScore);
            await this.ig.media.comment({
                mediaId: mediaId,
                text: comment
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

    private async calculateFanScore(user: any, comment: any): Promise<number> {
        const baseScore = 1;
        let score = baseScore;
        
        // Comment quality scoring
        const commentText = comment.text.toLowerCase();
        if (commentText.length > 50) score += 2;
        if (commentText.includes('teddy') || commentText.includes('swims')) score += 3;
        if (commentText.match(/(🎵|🎤|❤️|🔥|👏)/g)) score += 1;
        
        // Check user's profile and content
        try {
            const userInfo = await this.ig.user.info(user.pk);
            const userFeed = this.ig.feed.user(user.pk);
            const posts = await userFeed.items();
            
            // Profile metrics
            if (userInfo.follower_count > 100) score += 1;
            if (userInfo.following_count < userInfo.follower_count) score += 2;
            if (userInfo.media_count > 10) score += 1;
            
            // Content analysis
            const teddyRelatedPosts = posts.filter(post => 
                post.caption?.text.toLowerCase().includes('teddy') ||
                post.caption?.text.toLowerCase().includes('swims')
            );
            
            score += Math.min(teddyRelatedPosts.length * 2, 10);
            
            // Store or update fan score
            const existingScore = this.fanScores.get(user.pk);
            if (existingScore) {
                score = (score + existingScore.score) / 2; // Rolling average
            }
            
            this.fanScores.set(user.pk, {
                userId: user.pk,
                username: user.username,
                score,
                lastUpdated: new Date(),
                engagementHistory: {
                    comments: existingScore?.engagementHistory.comments || 1,
                    likes: existingScore?.engagementHistory.likes || 0,
                    teddyMentions: teddyRelatedPosts.length,
                    postQuality: posts.reduce((acc, post) => acc + (post.like_count || 0), 0) / posts.length
                }
            });
            
        } catch (error) {
            console.error(`Error calculating fan score: ${error.message}`);
        }
        
        return score;
    }

    private async shouldEngageWithFan(user: any, comment: any): Promise<boolean> {
        const score = await this.calculateFanScore(user, comment);
        return score >= 5; // Minimum threshold for engagement
    }

    async processCommenterContent(commenter: any) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const dailyStats = this.analytics.dailyStats.find(stat => stat.date === today);
            
            const fanScore = this.fanScores.get(commenter.user_id);
            // Check if we should engage with this fan
            if (!await this.shouldEngageWithFan(commenter.user, commenter)) {
                console.log(`Skipping low-score fan: ${commenter.username}`);
                dailyStats.skippedEngagements++;
                return;
            }
            
            // Get commenter's recent posts
            const userFeed = this.ig.feed.user(commenter.user_id);
            const userPosts = await userFeed.items();
            
            console.log(`Processing content from fan: ${commenter.username}`);
            
            // Process their recent posts
            for (const post of userPosts.slice(0, 3)) { // Look at their 3 most recent posts
                if (!this.isRunning) break;

                // Like their post
                await this.likePost(post.id);
                await delay();

                // Comment on their post if it's Teddy-related
                const isRelevant = post.caption?.text.toLowerCase().includes('teddy') || 
                                 post.caption?.text.toLowerCase().includes('swims');
                
                if (isRelevant) {
                    await this.commentOnPost(post.id, post, fanScore);
                    await delay();
                }
            }

            // Follow them if we haven't already
            await this.followUser(commenter.user_id.toString());
            
            dailyStats.successfulEngagements++;
            
        } catch (error) {
            console.error(`Error processing fan content: ${error.message}`);
            await this.handleRateLimit(error);
        }
    }

    async processTargetAccount(username: string) {
        try {
            const user = await this.ig.user.searchExact(username);
            console.log(`👤 Found account: ${username} (${user.pk})`);
            
            const feed = this.ig.feed.user(user.pk);
            const posts = await feed.items();
            console.log(`📱 Found ${posts.length} posts`);
            
            for (const post of posts.slice(0, 5)) {
                if (!this.isRunning) break;

                console.log(`\n📝 Processing post: ${post.id}`);
                console.log(`Caption: ${post.caption?.text?.substring(0, 50)}...`);

                const commentsFeed = this.ig.feed.mediaComments(post.id);
                const comments = await commentsFeed.items();
                console.log(`💬 Found ${comments.length} comments`);
                
                for (const comment of comments) {
                    if (!this.isRunning) break;

                    if (comment.content_type === 'comment' && comment.text.length > 10) {
                        console.log(`\n👉 Processing comment by ${comment.user.username}:`);
                        console.log(`Comment: ${comment.text}`);
                        
                        const isPassionate = comment.text.toLowerCase().includes('teddy') ||
                                          comment.text.toLowerCase().includes('love') ||
                                          comment.text.toLowerCase().includes('amazing') ||
                                          comment.text.toLowerCase().includes('🔥') ||
                                          comment.text.toLowerCase().includes('❤️');
                        
                        if (isPassionate) {
                            console.log('✨ Passionate fan detected! Processing their content...');
                            await this.processCommenterContent(comment);
                        } else {
                            console.log('⏩ Skipping non-passionate comment');
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Error processing account ${username}:`, error.message);
            await this.handleRateLimit(error);
        }
    }

    private async updateAnalytics() {
        const today = new Date().toISOString().split('T')[0];
        let dailyStats = this.analytics.dailyStats.find(stat => stat.date === today);
        
        if (!dailyStats) {
            dailyStats = {
                date: today,
                follows: 0,
                likes: 0,
                comments: 0,
                fanScores: [],
                successfulEngagements: 0,
                skippedEngagements: 0
            };
            this.analytics.dailyStats.push(dailyStats);
        }
        
        // Update daily stats
        dailyStats.follows = this.dailyStats.follows;
        dailyStats.likes = this.dailyStats.likes;
        dailyStats.comments = this.dailyStats.comments;
        
        // Calculate fan scores
        const scores = Array.from(this.fanScores.values());
        dailyStats.fanScores = scores.map(fan => fan.score);
        
        // Update top fans
        this.analytics.topFans = scores
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
        
        // Calculate engagement rates
        const totalEngagements = dailyStats.follows + dailyStats.likes + dailyStats.comments;
        const successRate = dailyStats.successfulEngagements / 
            (dailyStats.successfulEngagements + dailyStats.skippedEngagements) || 0;
        
        this.analytics.engagementRates = {
            followBackRate: dailyStats.follows > 0 ? 
                (await this.calculateFollowBackRate()) : 0,
            commentResponseRate: dailyStats.comments > 0 ?
                (await this.calculateCommentResponseRate()) : 0,
            averageFanScore: dailyStats.fanScores.length > 0 ?
                dailyStats.fanScores.reduce((a, b) => a + b, 0) / dailyStats.fanScores.length : 0
        };
        
        // Log daily summary
        console.log('\nDaily Engagement Summary:');
        console.log(`Date: ${today}`);
        console.log(`Follows: ${dailyStats.follows}`);
        console.log(`Likes: ${dailyStats.likes}`);
        console.log(`Comments: ${dailyStats.comments}`);
        console.log(`Average Fan Score: ${this.analytics.engagementRates.averageFanScore.toFixed(2)}`);
        console.log(`Success Rate: ${(successRate * 100).toFixed(2)}%`);
        console.log(`Top Fan: ${this.analytics.topFans[0]?.username || 'None'} (Score: ${this.analytics.topFans[0]?.score.toFixed(2) || 0})\n`);
    }

    private async calculateFollowBackRate(): Promise<number> {
        try {
            const recentFollows = Array.from(this.fanScores.values())
                .filter(fan => fan.lastUpdated > new Date(Date.now() - 24 * 60 * 60 * 1000));
            
            let followBacks = 0;
            for (const fan of recentFollows) {
                const friendship = await this.ig.friendship.show(fan.userId);
                if (friendship.followed_by) followBacks++;
                await delay(1000, 2000); // Gentle delay to avoid rate limits
            }
            
            return followBacks / recentFollows.length || 0;
        } catch (error) {
            console.error('Error calculating follow-back rate:', error);
            return 0;
        }
    }

    private async calculateCommentResponseRate(): Promise<number> {
        try {
            const recentComments = this.analytics.dailyStats
                .slice(-7) // Last 7 days
                .reduce((acc, stat) => acc + stat.comments, 0);
            
            // Get the most recent post's mediaId
            const feed = this.ig.feed.user(this.ig.state.cookieUserId);
            const posts = await feed.items();
            if (posts.length === 0) return 0;
            
            const responses = await this.countCommentResponses(posts[0].id);
            return responses / recentComments || 0;
        } catch (error) {
            console.error('Error calculating comment response rate:', error);
            return 0;
        }
    }

    private async processHashtag(hashtag: string) {
        try {
            console.log(`Processing hashtag #${hashtag}`);
            const feed = this.ig.feed.tag(hashtag);
            const posts = await feed.items();
            
            for (const post of posts.slice(0, 5)) { // Process top 5 posts for each hashtag
                if (this.dailyStats.likes >= DAILY_LIMITS.LIKES) {
                    console.log('Daily like limit reached');
                    break;
                }
                
                try {
                    // Like the post
                    await this.ig.media.like({
                        mediaId: post.id,
                        moduleInfo: {
                            module_name: 'feed_timeline'
                        },
                        d: 1
                    });
                    this.dailyStats.likes++;
                    console.log(`Liked post by ${post.user.username}`);
                    
                    // Add a comment if we haven't hit the limit
                    if (this.dailyStats.comments < DAILY_LIMITS.COMMENTS) {
                        const comment = await this.generateComment(post);
                        await this.ig.media.comment({
                            mediaId: post.id,
                            text: comment
                        });
                        this.dailyStats.comments++;
                        console.log(`Commented on post by ${post.user.username}`);
                    }
                    
                    await delay();
                } catch (error) {
                    console.error(`Error processing post from hashtag #${hashtag}:`, error);
                    await this.handleRateLimit(error);
                }
            }
        } catch (error) {
            console.error(`Error processing hashtag #${hashtag}:`, error);
            await this.handleRateLimit(error);
        }
    }

    private async startEngagementLoop() {
        this.isRunning = true;
        console.log('🔄 Starting Instagram engagement process...');
        console.log('📊 Daily Limits:', DAILY_LIMITS);

        while (this.isRunning) {
            try {
                // Process target accounts
                const targetAccounts = this.character.settings.secrets.INSTAGRAM_TARGET_ACCOUNTS.split(',');
                console.log('\n👥 Processing target accounts:', targetAccounts);
                
                for (const account of targetAccounts) {
                    if (!this.isRunning) break;
                    console.log(`\n🎯 Processing account: ${account.trim()}`);
                    await this.processTargetAccount(account.trim());
                    await delay(5000, 10000);
                }

                // Process hashtags
                console.log('\n🏷️ Processing hashtags...');
                for (const hashtag of [...HASHTAGS.PRIMARY, ...HASHTAGS.SECONDARY]) {
                    if (!this.isRunning) break;
                    console.log(`\n#️⃣ Processing hashtag: #${hashtag}`);
                    await this.processHashtag(hashtag);
                    await delay(5000, 10000);
                }

                // Log engagement stats
                console.log('\n📈 Daily Engagement Stats:');
                console.log('---------------------------');
                console.log('👍 Likes:', this.dailyStats.likes, '/', DAILY_LIMITS.LIKES);
                console.log('💬 Comments:', this.dailyStats.comments, '/', DAILY_LIMITS.COMMENTS);
                console.log('➕ Follows:', this.dailyStats.follows, '/', DAILY_LIMITS.FOLLOWS);
                console.log('⏰ Time active:', Math.floor(
                    (new Date().getTime() - this.dailyStats.startTime.getTime()) / (1000 * 60 * 60)
                ), 'hours');

                // Update analytics
                if (new Date().getMinutes() === 0) {
                    console.log('\n📊 Updating analytics...');
                    await this.updateAnalytics();
                }

                const waitTime = Math.floor(Math.random() * (3600000 - 1800000 + 1)) + 1800000;
                console.log(`\n⏳ Waiting ${Math.floor(waitTime/60000)} minutes before next cycle...`);
                await delay(waitTime);
            } catch (error) {
                console.error('❌ Error in engagement loop:', error);
                console.log('⏳ Waiting 5 minutes before retrying...');
                await delay(300000);
            }
        }
    }
} 