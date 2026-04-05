// ============================================
// index.js - Bot Discord com Sistema de Avaliação
// ============================================
// Versão: 7.0.0 - VERSÃO FINAL TESTADA
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

// ============================================
// VARIÁVEIS DE AMBIENTE
// ============================================
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
// Seus IDs de cargos
const STAFF_ROLE_IDS = [
    '1392306082289811670',
    '1392306074987659449', 
    '1392306046655008891',
    '1392306043215679599'
];
const REVIEWS_CHANNEL_ID = process.env.REVIEWS_CHANNEL_ID;
const REVIEWS_LOG_CHANNEL_ID = process.env.REVIEWS_LOG_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// Constantes
const PREFIX = '!';
const EMBED_COLOR = '#341539';
const MAX_FEEDBACK_LENGTH = 700;

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
        return { reviews: 0, users: {}, lastWeeklyReset: null };
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

function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// ============================================
// FUNÇÃO PRINCIPAL - BUSCAR MEMBROS STAFF
// ============================================

async function getStaffMembers(guild) {
    console.log('\n🔍 BUSCANDO MEMBROS STAFF...');
    console.log(`📡 Servidor: ${guild.name} (${guild.id})`);
    console.log(`🔧 Cargos staff: ${STAFF_ROLE_IDS.length}`);
    
    // FORÇAR o cache de todos os membros
    console.log('📥 Forçando carregamento de todos os membros...');
    await guild.members.fetch({ 
        limit: 1000,
        force: true,
        cache: true
    });
    
    console.log('✅ Cache de membros carregado!');
    
    const staffMembers = [];
    
    // Para cada cargo staff
    for (const roleId of STAFF_ROLE_IDS) {
        const role = guild.roles.cache.get(roleId);
        
        if (!role) {
            console.log(`❌ Cargo não encontrado: ${roleId}`);
            continue;
        }
        
        console.log(`\n📌 Cargo encontrado: ${role.name}`);
        console.log(`   👥 Membros no cargo: ${role.members.size}`);
        
        // Listar membros do cargo
        for (const [memberId, member] of role.members) {
            // Não incluir o próprio avaliador (será filtrado depois)
            if (!staffMembers.find(m => m.id === memberId)) {
                staffMembers.push({
                    id: member.id,
                    name: member.user.tag,
                    displayName: member.displayName,
                    roleName: role.name,
                    roleId: role.id
                });
                console.log(`   ✅ ${member.user.tag} (${member.id})`);
            }
        }
    }
    
    console.log(`\n📊 TOTAL DE MEMBROS STAFF: ${staffMembers.length}`);
    return staffMembers;
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
            averageScore: parseFloat((data.totalScore / data.count).toFixed(2)),
            totalReviews: data.count
        });
    }
    
    rankings.sort((a, b) => b.averageScore - a.averageScore);
    return rankings.slice(0, 3);
}

async function sendWeeklyRanking() {
    const top3 = await generateWeeklyRanking();
    if (!top3 || top3.length === 0) return;
    
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;
    
    const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking Semanal da Equipe')
        .setDescription('Os 3 membros mais bem avaliados desta semana:')
        .setColor(0xFFD700)
        .setTimestamp();
    
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < top3.length; i++) {
        embed.addFields({
            name: `${medals[i]} ${top3[i].userName}`,
            value: `⭐ Média: ${top3[i].averageScore}/10 | 📝 ${top3[i].totalReviews} avaliações`,
            inline: false
        });
    }
    
    await logChannel.send({ embeds: [embed] });
}

// ============================================
// COMANDOS SLASH
// ============================================

const clearAllCommand = new SlashCommandBuilder()
    .setName('clearall')
    .setDescription('Apaga todas as mensagens de um canal específico')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('Canal que terá as mensagens apagadas')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Quantidade de mensagens (padrão: 100)')
            .setMinValue(1)
            .setMaxValue(1000)
            .setRequired(false));

const clearCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga mensagens de um usuário específico')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário que terá as mensagens apagadas')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Quantidade de mensagens (padrão: 100)')
            .setMinValue(1)
            .setMaxValue(500)
            .setRequired(false));

const statsCommand = new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Mostra estatísticas do sistema de avaliação')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('Usuário para ver estatísticas')
            .setRequired(false));

const rankingCommand = new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Mostra o ranking atual da semana');

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
    
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error(`❌ Guild ${GUILD_ID} não encontrada!`);
        return;
    }
    
    // Buscar membros staff
    const staffMembers = await getStaffMembers(guild);
    
    const embed = new EmbedBuilder()
        .setTitle('📊 Sistema de Avaliação da Equipe')
        .setDescription('Clique no botão abaixo para avaliar um membro da nossa equipe!')
        .setColor(EMBED_COLOR)
        .addFields(
            { name: '📋 Como funciona', value: '```\n1️⃣ Clique no botão "Avaliar equipe"\n2️⃣ Selecione o membro que deseja avaliar\n3️⃣ Escolha uma nota de 0 a 10\n4️⃣ Escreva seu feedback (opcional)\n5️⃣ Envie sua avaliação\n```', inline: false },
            { name: '🎯 Quem pode avaliar', value: '✅ **Todos os membros** que não são da staff', inline: true },
            { name: '⭐ Quem é avaliado', value: `👥 **${staffMembers.length} membros** da staff`, inline: true },
            { name: '⭐ Sistema de Notas', value: '🔴 0-3: Insatisfatório\n🟡 4-6: Regular\n🟢 7-10: Excelente', inline: false }
        )
        .setFooter({ text: `Sistema de Avaliação • ${guild.name}` })
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
    console.log(`🎯 Guild ID: ${GUILD_ID}`);
    console.log('='.repeat(60));
    
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        console.error(`❌ Bot não está no servidor ${GUILD_ID}!`);
        console.log('📌 Servidores que o bot está:');
        client.guilds.cache.forEach(g => {
            console.log(`   - ${g.name} (${g.id})`);
        });
        return;
    }
    
    console.log(`✅ Conectado ao servidor: ${guild.name}`);
    
    // Registrar comandos
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log('✅ Comandos slash registrados');
    } catch (error) {
        console.error('❌ Erro:', error);
    }
    
    // Aguardar e configurar
    await delay(3000);
    await setupReviewsChannel();
    
    // Ranking semanal
    setInterval(() => {
        const now = new Date();
        if (now.getDay() === 0 && now.getHours() === 23) {
            sendWeeklyRanking();
        }
    }, 60 * 60 * 1000);
});

// ============================================
// HANDLER: COMANDOS SLASH
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    const { commandName, member, options } = interaction;
    
    if (commandName === 'clearall' || commandName === 'clear') {
        if (!isStaff(member)) {
            return interaction.reply({
                content: '❌ Apenas staff pode usar este comando!',
                flags: MessageFlags.Ephemeral
            });
        }
    }
    
    if (commandName === 'clearall') {
        const channel = options.getChannel('channel');
        const limit = options.getInteger('limit') || 100;
        
        await interaction.reply({ content: `🔄 Apagando...`, flags: MessageFlags.Ephemeral });
        
        try {
            let deletedCount = 0;
            let remaining = limit;
            
            while (remaining > 0) {
                const fetchLimit = Math.min(remaining, 100);
                const fetched = await channel.messages.fetch({ limit: fetchLimit });
                if (fetched.size === 0) break;
                
                const deleted = await channel.bulkDelete(fetched, true);
                deletedCount += deleted.size;
                remaining -= deleted.size;
                await delay(500);
            }
            
            await interaction.editReply({ content: `✅ ${deletedCount} mensagens apagadas!` });
            
            const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(`📝 ${member.user.tag} apagou ${deletedCount} mensagens em ${channel}`);
            }
        } catch (error) {
            await interaction.editReply({ content: '❌ Erro ao apagar!' });
        }
    }
    
    if (commandName === 'clear') {
        const targetUser = options.getUser('user');
        const limit = options.getInteger('limit') || 100;
        const channel = interaction.channel;
        
        await interaction.reply({ content: `🔄 Apagando...`, flags: MessageFlags.Ephemeral });
        
        try {
            let deletedCount = 0;
            let remaining = limit;
            
            while (remaining > 0) {
                const fetchLimit = Math.min(remaining, 100);
                const fetched = await channel.messages.fetch({ limit: fetchLimit });
                const toDelete = fetched.filter(msg => msg.author.id === targetUser.id);
                
                if (toDelete.size === 0) break;
                
                await channel.bulkDelete(toDelete, true);
                deletedCount += toDelete.size;
                remaining -= toDelete.size;
                await delay(500);
            }
            
            await interaction.editReply({ content: `✅ ${deletedCount} mensagens de ${targetUser.tag} apagadas!` });
            
            const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
            if (logChannel) {
                await logChannel.send(`📝 ${member.user.tag} apagou ${deletedCount} mensagens de ${targetUser.tag}`);
            }
        } catch (error) {
            await interaction.editReply({ content: '❌ Erro ao apagar!' });
        }
    }
    
    if (commandName === 'stats') {
        const targetUser = options.getUser('user') || interaction.user;
        const reviews = loadReviews();
        const userReviews = reviews.filter(r => r.reviewedId === targetUser.id);
        
        if (userReviews.length === 0) {
            return interaction.reply({ content: `📊 ${targetUser.tag} não tem avaliações.`, flags: MessageFlags.Ephemeral });
        }
        
        const scores = userReviews.map(r => r.score);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${targetUser.tag}`)
            .setColor(getColorByScore(avg))
            .addFields(
                { name: '📝 Avaliações', value: userReviews.length.toString(), inline: true },
                { name: '⭐ Média', value: avg.toFixed(2), inline: true },
                { name: '📈 Melhor', value: Math.max(...scores).toString(), inline: true },
                { name: '📉 Pior', value: Math.min(...scores).toString(), inline: true }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }
    
    if (commandName === 'ranking') {
        const top3 = await generateWeeklyRanking();
        
        if (!top3 || top3.length === 0) {
            return interaction.reply({ content: '📊 Nenhuma avaliação esta semana!', flags: MessageFlags.Ephemeral });
        }
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 Ranking da Semana')
            .setColor(0xFFD700)
            .setTimestamp();
        
        const medals = ['🥇', '🥈', '🥉'];
        for (let i = 0; i < top3.length; i++) {
            embed.addFields({
                name: `${medals[i]} ${top3[i].userName}`,
                value: `⭐ ${top3[i].averageScore}/10 | 📝 ${top3[i].totalReviews}`,
                inline: false
            });
        }
        
        await interaction.reply({ embeds: [embed] });
    }
});

// ============================================
// HANDLER: BOTÃO
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'open_review_menu') return;
    
    const member = interaction.member;
    
    if (!canReview(member)) {
        return interaction.reply({
            content: '❌ Membros da staff não podem avaliar!',
            flags: MessageFlags.Ephemeral
        });
    }
    
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        return interaction.reply({ content: '❌ Erro!', flags: MessageFlags.Ephemeral });
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    // Buscar membros staff
    const staffMembers = await getStaffMembers(guild);
    
    // Filtrar o próprio usuário
    const availableMembers = staffMembers.filter(m => m.id !== member.id);
    
    if (availableMembers.length === 0) {
        return interaction.editReply({ content: '❌ Nenhum membro da staff disponível!' });
    }
    
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_staff')
        .setPlaceholder(`👤 Selecione um membro (${availableMembers.length} disponíveis)`)
        .addOptions(
            availableMembers.map(m => ({
                label: m.name.length > 25 ? m.name.substring(0, 22) + '...' : m.name,
                value: m.id,
                description: `Cargo: ${m.roleName}`,
                emoji: '⭐'
            })).slice(0, 25)
        );
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await interaction.editReply({
        content: `**📋 Selecione o membro da staff para avaliar:**`,
        components: [row]
    });
});

// ============================================
// HANDLER: SELECT MENU
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'select_staff') return;
    
    const selectedId = interaction.values[0];
    const guild = client.guilds.cache.get(GUILD_ID);
    
    if (!guild) {
        return interaction.update({ content: '❌ Erro!', components: [] });
    }
    
    await guild.members.fetch();
    const target = await guild.members.fetch(selectedId).catch(() => null);
    
    if (!target) {
        return interaction.update({ content: '❌ Usuário não encontrado!', components: [] });
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
        return interaction.update({ content: '❌ Limite de 10 avaliações por dia!', components: [] });
    }
    
    // Modal
    const modal = new ModalBuilder()
        .setCustomId(`review_${selectedId}`)
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
        .setLabel('Feedback (max 700 caracteres)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('O que você achou? O que podia melhorar?')
        .setRequired(false)
        .setMaxLength(700);
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(scoreInput),
        new ActionRowBuilder().addComponents(feedbackInput)
    );
    
    client.tempReviewData.set(interaction.user.id, {
        targetId: selectedId,
        targetName: target.user.tag
    });
    
    await interaction.showModal(modal);
});

// ============================================
// HANDLER: MODAL
// ============================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('review_')) return;
    
    const targetId = interaction.customId.replace('review_', '');
    const score = parseInt(interaction.fields.getTextInputValue('score'));
    const feedback = interaction.fields.getTextInputValue('feedback') || 'Sem feedback';
    
    if (isNaN(score) || score < 0 || score > 10) {
        return interaction.reply({
            content: '❌ Nota inválida! Use 0 a 10.',
            flags: MessageFlags.Ephemeral
        });
    }
    
    const temp = client.tempReviewData.get(interaction.user.id);
    if (!temp || temp.targetId !== targetId) {
        return interaction.reply({
            content: '❌ Sessão expirada!',
            flags: MessageFlags.Ephemeral
        });
    }
    
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        return interaction.reply({ content: '❌ Erro!', flags: MessageFlags.Ephemeral });
    }
    
    await guild.members.fetch();
    const reviewer = interaction.user;
    const reviewed = await guild.members.fetch(targetId).catch(() => null);
    
    if (!reviewed) {
        return interaction.reply({ content: '❌ Usuário não encontrado!', flags: MessageFlags.Ephemeral });
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
    
    // Log embed
    const logEmbed = new EmbedBuilder()
        .setTitle(`${getScoreEmoji(score)} Nova Avaliação`)
        .setColor(getColorByScore(score))
        .addFields(
            { name: '👤 Avaliador', value: reviewer.tag, inline: true },
            { name: '⭐ Avaliado', value: reviewed.user.tag, inline: true },
            { name: '🎯 Nota', value: `${score}/10`, inline: true },
            { name: '💬 Feedback', value: feedback, inline: false }
        )
        .setTimestamp();
    
    const logChannel = client.channels.cache.get(REVIEWS_LOG_CHANNEL_ID);
    if (logChannel) {
        await logChannel.send({ embeds: [logEmbed] });
    }
    
    client.tempReviewData.delete(interaction.user.id);
    
    await interaction.reply({
        content: `✅ Avaliação para **${reviewed.user.displayName}** registrada! Nota: ${score}/10`,
        flags: MessageFlags.Ephemeral
    });
    
    console.log(`📝 ${reviewer.tag} -> ${reviewed.user.tag}: ${score}/10`);
});

// ============================================
// MENSAGENS DE TEXTO
// ============================================

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📚 Comandos')
            .setColor(EMBED_COLOR)
            .addFields(
                { name: 'Slash', value: '`/clearall` `/clear` `/stats` `/ranking`', inline: false },
                { name: 'Texto', value: '`!help` `!ping` `!top` `!stats @user`', inline: false }
            );
        await message.reply({ embeds: [embed] });
    }
    
    else if (command === 'ping') {
        const sent = await message.reply('🏓 Pong!');
        const latency = sent.createdTimestamp - message.createdTimestamp;
        await sent.edit(`🏓 Pong! ${latency}ms | API: ${Math.round(client.ws.ping)}ms`);
    }
    
    else if (command === 'top') {
        const reviews = loadReviews();
        const scores = new Map();
        
        reviews.forEach(r => {
            if (!scores.has(r.reviewedId)) {
                scores.set(r.reviewedId, { name: r.reviewedName, total: 0, count: 0 });
            }
            const data = scores.get(r.reviewedId);
            data.total += r.score;
            data.count++;
        });
        
        const ranking = [];
        for (const [id, data] of scores) {
            ranking.push({
                name: data.name,
                avg: (data.total / data.count).toFixed(2),
                count: data.count
            });
        }
        
        ranking.sort((a, b) => parseFloat(b.avg) - parseFloat(a.avg));
        const top10 = ranking.slice(0, 10);
        
        if (top10.length === 0) {
            return message.reply('📊 Sem avaliações!');
        }
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 Top 10 Geral')
            .setColor(0xFFD700);
        
        top10.forEach((r, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}º`;
            embed.addFields({ name: `${medal} ${r.name}`, value: `⭐ ${r.avg}/10 | 📝 ${r.count}`, inline: false });
        });
        
        await message.reply({ embeds: [embed] });
    }
    
    else if (command === 'stats') {
        const target = message.mentions.users.first() || message.author;
        const reviews = loadReviews();
        const userReviews = reviews.filter(r => r.reviewedId === target.id);
        
        if (userReviews.length === 0) {
            return message.reply(`📊 ${target.tag} sem avaliações.`);
        }
        
        const scores = userReviews.map(r => r.score);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${target.tag}`)
            .setColor(getColorByScore(avg))
            .addFields(
                { name: '📝 Total', value: userReviews.length.toString(), inline: true },
                { name: '⭐ Média', value: avg.toFixed(2), inline: true },
                { name: '📈 Melhor', value: Math.max(...scores).toString(), inline: true },
                { name: '📉 Pior', value: Math.min(...scores).toString(), inline: true }
            );
        
        await message.reply({ embeds: [embed] });
    }
});

// ============================================
// LIMPEZA
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
// INICIALIZAÇÃO
// ============================================

console.log('='.repeat(60));
console.log('🚀 BOT DE AVALIAÇÃO v7.0');
console.log('='.repeat(60));
console.log(`🎯 GUILD_ID: ${GUILD_ID}`);
console.log(`🔧 CARGOS: ${STAFF_ROLE_IDS.length}`);
console.log('='.repeat(60));

client.login(TOKEN).catch(error => {
    console.error('❌ Erro:', error);
    process.exit(1);
});