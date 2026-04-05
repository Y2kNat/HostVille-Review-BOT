// ============================================
// index.js - Bot Discord com Sistema de Avaliação
// ============================================
// Versão: 9.0.0 - COM CACHE E ANTI-RATE-LIMIT
// ============================================

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    Collection,
    MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIGURAÇÃO DO CLIENT
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Collections
client.commands = new Collection();
client.tempReviewData = new Map();
client.staffMembersCache = null;
client.lastFetchTime = 0;

// ============================================
// VARIÁVEIS DE AMBIENTE
// ============================================
const TOKEN = process.env.TOKEN;
const REVIEWS_CHANNEL_ID = process.env.REVIEWS_CHANNEL_ID;
const REVIEWS_LOG_CHANNEL_ID = process.env.REVIEWS_LOG_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// IDs dos cargos staff (hardcoded)
const STAFF_ROLE_IDS = [
    '1392306082289811670',
    '1392306074987659449',
    '1392306046655008891',
    '1392306043215679599',
    '1392306051415539774'
];

// Constantes
const EMBED_COLOR = '#341539';
const MAX_FEEDBACK_LENGTH = 700;
const CACHE_TTL = 300000; // 5 minutos de cache

// ============================================
// ARMAZENAMENTO EM ARQUIVO
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadReviews() {
    if (!fs.existsSync(REVIEWS_FILE)) return [];
    return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf-8'));
}

function saveReviews(reviews) {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
}

function loadStats() {
    if (!fs.existsSync(STATS_FILE)) {
        return { reviews: 0, users: {}, lastWeeklyReset: null, botStartTime: Date.now() };
    }
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
}

function saveStats(stats) {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// ============================================
// FUNÇÕES DE UTILIDADE
// ============================================

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Verificar se usuário é staff
function isStaff(member) {
    if (!member || !member.roles) return false;
    return STAFF_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
}

function canReview(member) {
    return !isStaff(member);
}

function getColorByScore(score) {
    if (score >= 0 && score <= 3) return 0xFF0000;
    if (score >= 4 && score <= 6) return 0xFFFF00;
    return 0x00FF00;
}

function getScoreEmoji(score) {
    if (score >= 0 && score <= 3) return '🔴';
    if (score >= 4 && score <= 6) return '🟡';
    return '🟢';
}

function getScoreDescription(score) {
    if (score === 0) return '💀 Precisa melhorar drasticamente';
    if (score === 1) return '😭 Muito insatisfatório';
    if (score === 2) return '😞 Insatisfatório';
    if (score === 3) return '😐 Abaixo da média';
    if (score === 4) return '🤔 Regular baixo';
    if (score === 5) return '😐 Regular';
    if (score === 6) return '🙂 Regular alto';
    if (score === 7) return '😊 Bom';
    if (score === 8) return '😃 Muito bom';
    if (score === 9) return '🌟 Excelente';
    if (score === 10) return '⭐ Perfeito!';
    return '📊 Nota inválida';
}

function formatDate(date) {
    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(date));
}

function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// ============================================
// BUSCAR MEMBROS STAFF COM CACHE
// ============================================

async function getStaffMembers(guild, forceRefresh = false) {
    const now = Date.now();
    
    // Usar cache se ainda for válido
    if (!forceRefresh && client.staffMembersCache && (now - client.lastFetchTime) < CACHE_TTL) {
        console.log('📦 Usando cache de membros staff');
        return client.staffMembersCache;
    }
    
    console.log('🔄 Buscando membros staff...');
    
    try {
        // Buscar apenas membros necessários com delay entre requisições
        await delay(1000);
        
        // Buscar membros do servidor de forma controlada
        const members = await guild.members.fetch({ 
            limit: 200,
            cache: true,
            force: false
        });
        
        console.log(`📊 Total de membros no servidor: ${members.size}`);
        
        const staffMembers = [];
        const processedIds = new Set();
        
        // Buscar membros por cargo
        for (const roleId of STAFF_ROLE_IDS) {
            await delay(500); // Delay entre cada cargo
            
            const role = guild.roles.cache.get(roleId);
            if (role) {
                console.log(`📌 Cargo: ${role.name} - ${role.members.size} membros`);
                
                for (const [memberId, member] of role.members) {
                    if (!processedIds.has(memberId)) {
                        processedIds.add(memberId);
                        staffMembers.push({
                            id: member.id,
                            name: member.user.tag,
                            displayName: member.displayName,
                            roleName: role.name,
                            roleId: role.id
                        });
                    }
                }
            } else {
                console.log(`⚠️ Cargo não encontrado: ${roleId}`);
            }
        }
        
        console.log(`✅ Total de membros staff únicos: ${staffMembers.length}`);
        
        // Atualizar cache
        client.staffMembersCache = staffMembers;
        client.lastFetchTime = now;
        
        return staffMembers;
        
    } catch (error) {
        console.error('❌ Erro ao buscar membros:', error.message);
        
        // Retornar cache antigo se disponível
        if (client.staffMembersCache) {
            console.log('⚠️ Usando cache antigo devido a erro');
            return client.staffMembersCache;
        }
        
        return [];
    }
}

// ============================================
// RANKING SEMANAL
// ============================================

async function generateWeeklyRanking() {
    const reviews = loadReviews();
    const now = new Date();
    const weekNumber = getWeekNumber(now);
    const year = now.getFullYear();
    
    const weekReviews = reviews.filter(review => {
        const reviewDate = new Date(review.createdAt);
        return getWeekNumber(reviewDate) === weekNumber && reviewDate.getFullYear() === year;
    });
    
    if (weekReviews.length === 0) return null;
    
    const userScores = new Map();
    
    weekReviews.forEach(review => {
        if (!userScores.has(review.reviewedId)) {
            userScores.set(review.reviewedId, {
                userId: review.reviewedId,
                userName: review.reviewedName,
                userTag: review.reviewedTag,
                totalScore: 0,
                count: 0
            });
        }
        const data = userScores.get(review.reviewedId);
        data.totalScore += review.score;
        data.count++;
    });
    
    const rankings = [];
    for (const [userId, data] of userScores) {
        rankings.push({
            userId: data.userId,
            userName: data.userName,
            userTag: data.userTag,
            averageScore: parseFloat((data.totalScore / data.count).toFixed(2)),
            totalReviews: data.count
        });
    }
    
    rankings.sort((a, b) => b.averageScore - a.averageScore);
    return rankings.slice(0, 3);
}

// ============================================
// ESTATÍSTICAS DO USUÁRIO
// ============================================

function calculateUserStats(userId) {
    const reviews = loadReviews();
    const userReviews = reviews.filter(r => r.reviewedId === userId);
    
    if (userReviews.length === 0) {
        return { count: 0, average: 0, highest: 0, lowest: 0, median: 0 };
    }
    
    const scores = userReviews.map(r => r.score);
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sorted = [...scores].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0 ? (sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2 : sorted[Math.floor(sorted.length/2)];
    
    return {
        count: userReviews.length,
        average: parseFloat(average.toFixed(2)),
        highest: Math.max(...scores),
        lowest: Math.min(...scores),
        median: parseFloat(median.toFixed(2)),
        recentReviews: userReviews.slice(-5).reverse()
    };
}

// ============================================
// COMANDOS SLASH
// ============================================

const clearAllCommand = new SlashCommandBuilder()
    .setName('clearall')
    .setDescription('🗑️ Apaga todas as mensagens de um canal específico')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('Canal que terá as mensagens apagadas')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Quantidade de mensagens (padrão: 100, máximo: 500)')
            .setMinValue(1)
            .setMaxValue(500)
            .setRequired(false));

const clearCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('🗑️ Apaga mensagens de um usuário específico')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário que terá as mensagens apagadas')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Quantidade de mensagens (padrão: 100, máximo: 500)')
            .setMinValue(1)
            .setMaxValue(500)
            .setRequired(false));

const statsCommand = new SlashCommandBuilder()
    .setName('stats')
    .setDescription('📊 Mostra estatísticas do sistema de avaliação')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário para ver estatísticas')
            .setRequired(false));

const rankingCommand = new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('🏆 Mostra o ranking atual da semana');

const commands = [clearAllCommand, clearCommand, statsCommand, rankingCommand];

// ============================================
// CONFIGURAR CANAL DE AVALIAÇÕES
// ============================================

async function setupReviewsChannel() {
    const channel = client.channels.cache.get(REVIEWS_CHANNEL_ID);
    if (!channel) {
        console.error('❌ Canal de avaliações não encontrado!');
        return;
    }
    
    const guild = channel.guild;
    const staffMembers = await getStaffMembers(guild);
    
    const embed = new EmbedBuilder()
        .setTitle('📊 Sistema de Avaliação da Equipe')
        .setDescription('Clique no botão abaixo para avaliar um membro da nossa equipe!')
        .setColor(EMBED_COLOR)
        .setThumbnail(guild.iconURL({ dynamic: true }) || client.user.displayAvatarURL())
        .addFields(
            { 
                name: '📋 Como funciona', 
                value: '```\n• Clique no botão "Avaliar equipe"\n• Selecione o membro que deseja avaliar\n• Escolha uma nota de 0 a 10\n• Escreva seu feedback (opcional)\n5️⃣ Envie sua avaliação\n```', 
                inline: false 
            },
            { 
                name: '🎯 Quem pode avaliar', 
                value: '✅ **Todos os membros** que não são da staff podem avaliar', 
                inline: true 
            },
            { 
                name: '⭐ Quem é avaliado', 
                value: `👥 **${staffMembers.length} membros** da staff disponíveis`, 
                inline: true 
            },
            { 
                name: '⭐ Sistema de Notas', 
                value: '🔴 **0-3:** Insatisfatório\n🟡 **4-6:** Regular\n🟢 **7-10:** Excelente', 
                inline: false 
            },
            { 
                name: '📈 Estatísticas', 
                value: `🏆 Ranking semanal: Ativo`, 
                inline: false 
            }
        )
        .setFooter({ text: `Sistema de Avaliação` })
        .setTimestamp();
    
    const button = new ButtonBuilder()
        .setCustomId('open_review_menu')
        .setLabel('🛠 Avaliar equipe')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('⭐');
    
    const row = new ActionRowBuilder().addComponents(button);
    
    // Limpar mensagens antigas
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(m => m.author.id === client.user.id);
        for (const msg of botMessages.values()) {
            await msg.delete().catch(() => {});
        }
    } catch (error) {}
    
    await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Canal de avaliações configurado');
}

// ============================================
// EVENTO: CLIENT_READY
// ============================================

client.once('clientReady', async () => {
    console.log('='.repeat(60));
    console.log(`🤖 Bot logado como ${client.user.tag}`);
    console.log(`📡 ID: ${client.user.id}`);
    console.log(`🔧 Cargos Staff configurados: ${STAFF_ROLE_IDS.length}`);
    console.log('='.repeat(60));
    
    // Registrar comandos globalmente
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Comandos slash registrados globalmente');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
    
    // Configurar canal de avaliações
    await delay(3000);
    await setupReviewsChannel();
    
    // Sistema de ranking semanal (verificar a cada hora)
    setInterval(async () => {
        const now = new Date();
        if (now.getDay() === 0 && now.getHours() === 23 && now.getMinutes() === 0) {
            const top3 = await generateWeeklyRanking();
            if (top3 && top3.length > 0) {
                const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('🏆 Ranking Semanal da Equipe')
                        .setDescription(`Semana ${getWeekNumber(now)} de ${now.getFullYear()}`)
                        .setColor(0xFFD700)
                        .setThumbnail('https://cdn.discordapp.com/emojis/890915467471437854.png')
                        .setTimestamp();
                    
                    const medals = ['🥇', '🥈', '🥉'];
                    for (let i = 0; i < top3.length; i++) {
                        embed.addFields({
                            name: `${medals[i]} ${top3[i].userName}`,
                            value: `⭐ Média: ${top3[i].averageScore}/10\n📝 Total: ${top3[i].totalReviews} avaliações`,
                            inline: false
                        });
                    }
                    
                    await logChannel.send({ embeds: [embed] });
                }
            }
        }
    }, 60 * 1000);
    
    // Atualizar cache a cada 5 minutos
    setInterval(async () => {
        const guild = client.guilds.cache.first();
        if (guild) {
            await getStaffMembers(guild, true);
        }
    }, CACHE_TTL);
    
    // Atualizar status
    updateStatus();
});

function updateStatus() {
    const activities = [
        { name: `${STAFF_ROLE_IDS.length} cargos da staff`, type: 3 },
        { name: '/clearall | /clear', type: 2 },
        { name: 'Sistema de Avaliação', type: 3 },
        { name: 'Avalie sua equipe!', type: 2 }
    ];
    
    let index = 0;
    setInterval(() => {
        const activity = activities[index % activities.length];
        client.user.setPresence({
            activities: [{ name: activity.name, type: activity.type }],
            status: 'online'
        });
        index++;
    }, 15000);
}

// ============================================
// HANDLER: COMANDOS SLASH
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    const { commandName, member, options } = interaction;
    
    // ========== COMANDO /clearall ==========
    if (commandName === 'clearall') {
        if (!isStaff(member)) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Permissão Negada')
                .setDescription('Você não tem permissão para usar este comando! Apenas membros da staff podem usar.')
                .setColor(0xFF0000)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const channel = options.getChannel('channel');
        const limit = Math.min(options.getInteger('limit') || 100, 500);
        
        if (!channel.isTextBased()) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Canal Inválido')
                .setDescription('Este não é um canal de texto válido!')
                .setColor(0xFF0000)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const processEmbed = new EmbedBuilder()
            .setTitle('🔄 Processando')
            .setDescription(`Apagando até **${limit}** mensagens do canal ${channel}...`)
            .setColor(0x00AAFF)
            .setTimestamp();
        
        await interaction.reply({ embeds: [processEmbed], flags: MessageFlags.Ephemeral });
        
        try {
            let deletedCount = 0;
            let fetched = await channel.messages.fetch({ limit: limit });
            const filtered = fetched.filter(msg => !msg.pinned);
            
            if (filtered.size === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('⚠️ Nada para apagar')
                    .setDescription('Não há mensagens não fixadas neste canal!')
                    .setColor(0xFFFF00)
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
            
            const deleted = await channel.bulkDelete(filtered, true);
            deletedCount = deleted.size;
            
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Limpeza Concluída')
                .setDescription(`**${deletedCount}** mensagens foram apagadas do canal ${channel}!`)
                .setColor(0x00FF00)
                .setTimestamp();
            
            await interaction.editReply({ embeds: [successEmbed] });
            
            const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('📝 Ação de Moderação')
                    .setDescription(`**Staff:** ${member.user.tag}\n**Ação:** Limpeza de canal\n**Canal:** ${channel}\n**Mensagens:** ${deletedCount}`)
                    .setColor(0xFFA500)
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }
            
        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Erro')
                .setDescription('Erro ao apagar mensagens! Mensagens podem ser muito antigas (mais de 14 dias).')
                .setColor(0xFF0000)
                .setTimestamp();
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
    
    // ========== COMANDO /clear ==========
    if (commandName === 'clear') {
        if (!isStaff(member)) {
            const embed = new EmbedBuilder()
                .setTitle('❌ Permissão Negada')
                .setDescription('Você não tem permissão para usar este comando! Apenas membros da staff podem usar.')
                .setColor(0xFF0000)
                .setTimestamp();
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const targetUser = options.getUser('user');
        const limit = Math.min(options.getInteger('limit') || 100, 500);
        const channel = interaction.channel;
        
        const processEmbed = new EmbedBuilder()
            .setTitle('🔄 Processando')
            .setDescription(`Apagando até **${limit}** mensagens de ${targetUser.tag}...`)
            .setColor(0x00AAFF)
            .setTimestamp();
        
        await interaction.reply({ embeds: [processEmbed], flags: MessageFlags.Ephemeral });
        
        try {
            let deletedCount = 0;
            let fetched = await channel.messages.fetch({ limit: limit });
            let messagesToDelete = fetched.filter(msg => msg.author.id === targetUser.id && !msg.pinned);
            
            if (messagesToDelete.size === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('⚠️ Nada para apagar')
                    .setDescription(`Não há mensagens de ${targetUser.tag} para apagar!`)
                    .setColor(0xFFFF00)
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
            
            await channel.bulkDelete(messagesToDelete, true);
            deletedCount = messagesToDelete.size;
            
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Limpeza Concluída')
                .setDescription(`**${deletedCount}** mensagens de ${targetUser.tag} foram apagadas!`)
                .setColor(0x00FF00)
                .setTimestamp();
            
            await interaction.editReply({ embeds: [successEmbed] });
            
            const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('📝 Ação de Moderação')
                    .setDescription(`**Staff:** ${member.user.tag}\n**Ação:** Limpeza de usuário\n**Alvo:** ${targetUser.tag}\n**Mensagens:** ${deletedCount}`)
                    .setColor(0xFFA500)
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }
            
        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Erro')
                .setDescription('Erro ao apagar mensagens! Mensagens podem ser muito antigas (mais de 14 dias).')
                .setColor(0xFF0000)
                .setTimestamp();
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
    
    // ========== COMANDO /stats ==========
    if (commandName === 'stats') {
        const targetUser = options.getUser('user') || interaction.user;
        const stats = calculateUserStats(targetUser.id);
        const allReviews = loadReviews();
        const totalReviews = allReviews.length;
        
        const scoreEmoji = getScoreEmoji(stats.average);
        
        const embed = new EmbedBuilder()
            .setTitle(`${scoreEmoji} Estatísticas de ${targetUser.tag}`)
            .setColor(getColorByScore(stats.average))
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📝 Total de avaliações', value: stats.count.toString(), inline: true },
                { name: '⭐ Média', value: stats.count > 0 ? `${stats.average}/10` : '0/10', inline: true },
                { name: '📐 Mediana', value: stats.count > 0 ? `${stats.median}/10` : 'N/A', inline: true },
                { name: '📈 Melhor nota', value: stats.count > 0 ? stats.highest.toString() : 'N/A', inline: true },
                { name: '📉 Pior nota', value: stats.count > 0 ? stats.lowest.toString() : 'N/A', inline: true },
                { name: '📊 Total no sistema', value: totalReviews.toString(), inline: true }
            )
            .setFooter({ text: `ID: ${targetUser.id} | Dados de todas as avaliações` })
            .setTimestamp();
        
        if (stats.count === 0) {
            embed.setDescription('📊 Este usuário ainda não recebeu nenhuma avaliação!');
        }
        
        // Adicionar últimas avaliações
        if (stats.recentReviews && stats.recentReviews.length > 0) {
            const recentText = stats.recentReviews.slice(0, 3).map(r => {
                const emoji = getScoreEmoji(r.score);
                return `${emoji} **${r.score}/10** - *"${r.feedback.substring(0, 50)}${r.feedback.length > 50 ? '...' : ''}"*\n👤 por ${r.reviewerName} (${formatDate(r.createdAt)})`;
            }).join('\n\n');
            embed.addFields({ name: '📋 Últimas avaliações', value: recentText, inline: false });
        }
        
        await interaction.reply({ embeds: [embed] });
    }
    
    // ========== COMANDO /ranking ==========
    if (commandName === 'ranking') {
        const top3 = await generateWeeklyRanking();
        const now = new Date();
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 Ranking da Semana')
            .setDescription(`Semana ${getWeekNumber(now)} de ${now.getFullYear()}`)
            .setColor(0xFFD700)
            .setThumbnail('https://cdn.discordapp.com/emojis/890915467471437854.png')
            .setTimestamp();
        
        if (!top3 || top3.length === 0) {
            embed.addFields({ name: '📊 Nenhum dado', value: 'Nenhuma avaliação foi feita esta semana ainda!', inline: false });
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            const medalNames = ['OURO', 'PRATA', 'BRONZE'];
            
            for (let i = 0; i < top3.length; i++) {
                const member = top3[i];
                const scoreEmoji = getScoreEmoji(member.averageScore);
                embed.addFields({
                    name: `${medals[i]} ${medalNames[i]} - ${member.userName}`,
                    value: `${scoreEmoji} **Média:** ${member.averageScore}/10\n📝 **Total de avaliações:** ${member.totalReviews}`,
                    inline: false
                });
            }
        }
        
        await interaction.reply({ embeds: [embed] });
    }
});

// ============================================
// HANDLER: BOTÃO DE AVALIAÇÃO
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'open_review_menu') return;
    
    const member = interaction.member;
    
    if (!canReview(member)) {
        const embed = new EmbedBuilder()
            .setTitle('❌ Permissão Negada')
            .setDescription('Você é membro da staff e não pode avaliar outros membros da staff! Apenas membros comuns podem avaliar.')
            .setColor(0xFF0000)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const guild = interaction.guild;
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const staffMembers = await getStaffMembers(guild);
    const availableMembers = staffMembers.filter(m => m.id !== member.id);
    
    if (availableMembers.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('❌ Nenhum Membro Disponível')
            .setDescription('Nenhum membro da staff disponível para avaliação no momento!\n\nVerifique se os cargos estão configurados corretamente.')
            .setColor(0xFF0000)
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_staff')
        .setPlaceholder(`👤 Selecione um membro da staff (${availableMembers.length} disponíveis)`)
        .addOptions(
            availableMembers.slice(0, 25).map(m => ({
                label: m.name.length > 25 ? m.name.substring(0, 22) + '...' : m.name,
                value: m.id,
                description: `Cargo: ${m.roleName.substring(0, 50)}`,
                emoji: '⭐'
            }))
        );
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    const embed = new EmbedBuilder()
        .setTitle('📋 Selecionar Membro da Staff')
        .setDescription(`Selecione abaixo o membro da staff que deseja avaliar:\n\n👥 **${availableMembers.length} membros** disponíveis`)
        .setColor(EMBED_COLOR)
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed], components: [row] });
});

// ============================================
// HANDLER: SELECT MENU
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'select_staff') return;
    
    const selectedId = interaction.values[0];
    const guild = interaction.guild;
    
    const target = await guild.members.fetch(selectedId).catch(() => null);
    
    if (!target) {
        const embed = new EmbedBuilder()
            .setTitle('❌ Usuário não encontrado')
            .setDescription('O membro selecionado não foi encontrado!')
            .setColor(0xFF0000)
            .setTimestamp();
        return interaction.update({ embeds: [embed], components: [] });
    }
    
    // Verificar limite diário
    const reviews = loadReviews();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = reviews.filter(r => 
        r.reviewerId === interaction.user.id && 
        new Date(r.createdAt) >= today
    ).length;
    
    if (todayCount >= 10) {
        const embed = new EmbedBuilder()
            .setTitle('❌ Limite Atingido')
            .setDescription('Você atingiu o limite de **10 avaliações por dia**! Volte amanhã.')
            .setColor(0xFF0000)
            .setTimestamp();
        return interaction.update({ embeds: [embed], components: [] });
    }
    
    // Criar modal
    const modal = new ModalBuilder()
        .setCustomId(`review_${selectedId}_${Date.now()}`)
        .setTitle(`Avaliar ${target.user.displayName}`);
    
    const scoreInput = new TextInputBuilder()
        .setCustomId('score')
        .setLabel('Nota (0 a 10)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Digite um número entre 0 e 10')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);
    
    const feedbackInput = new TextInputBuilder()
        .setCustomId('feedback')
        .setLabel('Feedback (max. 700 caracteres)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('O que você achou? O que podia melhorar?')
        .setRequired(false)
        .setMaxLength(MAX_FEEDBACK_LENGTH);
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(scoreInput),
        new ActionRowBuilder().addComponents(feedbackInput)
    );
    
    client.tempReviewData.set(interaction.user.id, {
        targetId: selectedId,
        targetName: target.user.tag,
        targetDisplayName: target.user.displayName,
        timestamp: Date.now()
    });
    
    await interaction.showModal(modal);
});

// ============================================
// HANDLER: MODAL DE AVALIAÇÃO
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('review_')) return;
    
    const parts = interaction.customId.split('_');
    const targetId = parts[1];
    
    const score = parseInt(interaction.fields.getTextInputValue('score'));
    const feedback = interaction.fields.getTextInputValue('feedback') || 'Sem feedback fornecido';
    
    if (isNaN(score) || score < 0 || score > 10) {
        const embed = new EmbedBuilder()
            .setTitle('❌ Nota Inválida')
            .setDescription('Por favor, insira um número entre **0 e 10**.')
            .setColor(0xFF0000)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const tempData = client.tempReviewData.get(interaction.user.id);
    if (!tempData || tempData.targetId !== targetId) {
        const embed = new EmbedBuilder()
            .setTitle('❌ Sessão Expirada')
            .setDescription('Sua sessão expirou! Por favor, clique no botão novamente.')
            .setColor(0xFF0000)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const guild = interaction.guild;
    const reviewer = interaction.user;
    const reviewed = await guild.members.fetch(targetId).catch(() => null);
    
    if (!reviewed) {
        const embed = new EmbedBuilder()
            .setTitle('❌ Usuário não encontrado')
            .setDescription('O membro avaliado não foi encontrado!')
            .setColor(0xFF0000)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    // Salvar avaliação
    const reviews = loadReviews();
    const newReview = {
        id: Date.now().toString(),
        reviewerId: reviewer.id,
        reviewedId: reviewed.id,
        reviewerName: reviewer.displayName,
        reviewedName: reviewed.user.displayName,
        reviewerTag: reviewer.tag,
        reviewedTag: reviewed.user.tag,
        score: score,
        feedback: feedback,
        createdAt: new Date().toISOString(),
        weekNumber: getWeekNumber(new Date()),
        year: new Date().getFullYear()
    };
    
    reviews.push(newReview);
    saveReviews(reviews);
    
    // Atualizar stats
    const stats = loadStats();
    stats.reviews = reviews.length;
    if (!stats.users[reviewed.id]) {
        stats.users[reviewed.id] = { name: reviewed.user.tag, reviews: 0, totalScore: 0 };
    }
    stats.users[reviewed.id].reviews++;
    stats.users[reviewed.id].totalScore += score;
    saveStats(stats);
    
    // Embed para o canal de logs
    const color = getColorByScore(score);
    const scoreEmoji = getScoreEmoji(score);
    const scoreDesc = getScoreDescription(score);
    
    const logEmbed = new EmbedBuilder()
        .setTitle(`${scoreEmoji} Nova Avaliação - ${scoreDesc}`)
        .setColor(color)
        .setThumbnail(reviewed.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: '👤 Avaliador', value: `${reviewer.tag} (${reviewer.id})`, inline: true },
            { name: '⭐ Avaliado', value: `${reviewed.user.tag} (${reviewed.id})`, inline: true },
            { name: '🎯 Nota', value: `${score}/10`, inline: true },
            { name: '💬 Feedback', value: feedback.length > 1024 ? feedback.substring(0, 1021) + '...' : feedback, inline: false }
        )
        .setFooter({ text: `ID da avaliação: ${newReview.id} | Semana ${getWeekNumber(new Date())}` })
        .setTimestamp();
    
    const logChannel = client.channels.cache.get(REVIEWS_LOG_CHANNEL_ID);
    if (logChannel) {
        await logChannel.send({ embeds: [logEmbed] });
    }
    
    // Limpar dados temporários
    client.tempReviewData.delete(interaction.user.id);
    
    // Resposta de sucesso
    const successEmbed = new EmbedBuilder()
        .setTitle('✅ Avaliação Enviada!')
        .setDescription(`Sua avaliação para **${reviewed.user.displayName}** foi registrada com sucesso!`)
        .setColor(0x00FF00)
        .addFields(
            { name: 'Nota atribuída', value: `${score}/10 - ${scoreDesc}`, inline: true },
            { name: 'Feedback', value: feedback.length > 200 ? feedback.substring(0, 197) + '...' : feedback, inline: false }
        )
        .setTimestamp();
    
    await interaction.reply({ embeds: [successEmbed], flags: MessageFlags.Ephemeral });
    
    console.log(`📝 Nova avaliação: ${reviewer.tag} -> ${reviewed.user.tag} (${score}/10)`);
});

// ============================================
// LIMPEZA PERIÓDICA
// ============================================

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of client.tempReviewData) {
        if (value.timestamp && now - value.timestamp > 30 * 60 * 1000) {
            client.tempReviewData.delete(key);
        }
    }
}, 5 * 60 * 1000);

// ============================================
// TRATAMENTO DE ERROS
// ============================================

process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error.message);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Exceção não capturada:', error.message);
});

// ============================================
// INICIALIZAÇÃO
// ============================================

console.log('='.repeat(60));
console.log('🚀 BOT DE AVALIAÇÃO v9.0 - ANTI RATE LIMIT');
console.log('='.repeat(60));
console.log(`🔧 Cargos Staff: ${STAFF_ROLE_IDS.length}`);
console.log(`📺 REVIEWS_CHANNEL_ID: ${REVIEWS_CHANNEL_ID || 'NÃO CONFIGURADO'}`);
console.log(`📝 REVIEWS_LOG_CHANNEL_ID: ${REVIEWS_LOG_CHANNEL_ID || 'NÃO CONFIGURADO'}`);
console.log(`📊 LOG_CHANNEL_ID: ${LOG_CHANNEL_ID || 'NÃO CONFIGURADO'}`);
console.log('='.repeat(60));

client.login(TOKEN).catch(error => {
    console.error('❌ Erro ao fazer login:', error);
    process.exit(1);
});

module.exports = { client, isStaff, canReview, getColorByScore, getScoreEmoji };
