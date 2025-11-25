const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const http = require('http');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Serveur HTTP pour Render (keep-alive)
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'online', 
        bot: client.user ? client.user.tag : 'Connecting...',
        uptime: process.uptime()
    }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Serveur HTTP démarré sur le port ${PORT}`);
});

const MODERATOR_ROLE_ID = '1440679798031515709';
const QUEUE_CHANNEL_ID = '1440604941608816661';

// Stockage temporaire des sélections en cours
const selections = new Map();
// Stockage des paiements enregistrés (pour modification)
const payments = new Map();

// Services disponibles
const SERVICES = {
    'normal_1': { label: 'Normal - 1 partie', price: '4€' },
    'hc_1': { label: 'Domination HC - 1 partie', price: '5€' },
    'normal_3': { label: 'Pack Normal - 3 parties', price: '10€' },
    'normal_5': { label: 'Pack Normal - 5 parties', price: '15€' },
    'normal_10': { label: 'Pack Normal - 10 parties', price: '25€' },
    'normal_20': { label: 'Pack Normal - 20 parties', price: '45€' },
    'hc_3': { label: 'Pack HC - 3 parties', price: '13€' },
    'hc_5': { label: 'Pack HC - 5 parties', price: '20€' },
    'hc_10': { label: 'Pack HC - 10 parties', price: '35€' },
    'hc_20': { label: 'Pack HC - 20 parties', price: '60€' },
    'standard_hour': { label: 'Standard - 1 heure', price: '20€' },
    'hc_hour': { label: 'Domination HC - 1 heure', price: '25€' }
};

client.once('ready', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    console.log(`📊 Serveurs: ${client.guilds.cache.size}`);
    console.log(`👥 Utilisateurs: ${client.users.cache.size}`);
    
    // Enregistrer les commandes slash
    const commands = [
        {
            name: 'paiement',
            description: 'Créer un nouveau paiement de service',
            default_member_permissions: PermissionFlagsBits.ModerateMembers.toString()
        },
        {
            name: 'paie',
            description: 'Affiche le lien PayPal pour effectuer un paiement'
        }
    ];
    
    try {
        console.log('📝 Mise à jour des commandes slash...');
        await client.application.commands.set(commands);
        console.log('✅ Commandes slash mises à jour avec succès !');
    } catch (error) {
        console.error('❌ Erreur lors de la mise à jour des commandes:', error);
    }
});

client.on('interactionCreate', async interaction => {
    // Commande /paie (accessible à tous)
    if (interaction.isChatInputCommand() && interaction.commandName === 'paie') {
        const paypalEmbed = new EmbedBuilder()
            .setTitle('💳 Effectuer un Paiement')
            .setDescription('Pour payer vos services, utilisez le lien PayPal ci-dessous :')
            .addFields({
                name: '🔗 Lien PayPal',
                value: '[Cliquez ici pour payer](https://www.paypal.me/VincentMartinsdias)',
                inline: false
            })
            .setColor('#00457C')
            .setThumbnail('https://upload.wikimedia.org/wikipedia/commons/b/b5/PayPal.svg')
            .setFooter({ text: 'Merci pour votre confiance !' })
            .setTimestamp();

        const paypalButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('Ouvrir PayPal')
                    .setURL('https://www.paypal.me/VincentMartinsdias')
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('💰')
            );

        return interaction.reply({ 
            embeds: [paypalEmbed], 
            components: [paypalButton]
        });
    }

    // Vérifier le rôle modérateur pour les autres commandes
    if (interaction.member && !interaction.member.roles.cache.has(MODERATOR_ROLE_ID)) {
        if (interaction.isCommand() || interaction.isButton() || interaction.isStringSelectMenu()) {
            return interaction.reply({ 
                content: '❌ Vous devez être modérateur pour utiliser cette commande.', 
                ephemeral: true 
            });
        }
    }

    // Commande /paiement
    if (interaction.isChatInputCommand() && interaction.commandName === 'paiement') {
        // Récupérer les membres du serveur (limité à 25 pour le menu)
        const members = await interaction.guild.members.fetch({ limit: 100 });
        const memberOptions = members
            .filter(member => !member.user.bot)
            .map(member => ({
                label: member.user.username,
                description: member.user.tag,
                value: member.user.id
            }))
            .slice(0, 25); // Discord limite à 25 options

        if (memberOptions.length === 0) {
            return interaction.reply({ 
                content: '❌ Aucun membre trouvé sur le serveur.', 
                ephemeral: true 
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('👤 Sélection du Membre')
            .setDescription('Choisissez le membre concerné par ce paiement :')
            .setColor('#5865F2');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_member')
            .setPlaceholder('Sélectionnez un membre')
            .addOptions(memberOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        
        // Initialiser la sélection
        selections.set(interaction.user.id, { userId: interaction.user.id });
    }

    // Gestion du menu de sélection de membre
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_member') {
        const selection = selections.get(interaction.user.id) || { userId: interaction.user.id };
        const selectedMemberId = interaction.values[0];
        const selectedMember = await interaction.guild.members.fetch(selectedMemberId);
        
        selection.member = {
            id: selectedMember.user.id,
            tag: selectedMember.user.tag,
            username: selectedMember.user.username
        };
        selections.set(interaction.user.id, selection);

        // Afficher les boutons de statut
        const embed = new EmbedBuilder()
            .setTitle('💰 Gestion de Paiement')
            .setDescription(`**Membre :** ${selectedMember.user.tag}\n\nSélectionnez l'état du montant :`)
            .setColor('#5865F2');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('status_pending')
                    .setLabel('Montant en attente')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⏳'),
                new ButtonBuilder()
                    .setCustomId('status_paid')
                    .setLabel('Montant payé')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );

        await interaction.update({ embeds: [embed], components: [row] });
    }

    // Gestion des boutons
    if (interaction.isButton()) {
        const selection = selections.get(interaction.user.id) || { userId: interaction.user.id };

        // Boutons de statut de paiement
        if (interaction.customId.startsWith('status_')) {
            selection.status = interaction.customId === 'status_paid' ? 'Payé' : 'En attente';
            selections.set(interaction.user.id, selection);

            // Afficher les services
            const embed = new EmbedBuilder()
                .setTitle('🎮 Sélection du Service')
                .setDescription(`**Membre :** ${selection.member.tag}\n**Statut :** ${selection.status}\n\nChoisissez le service :`)
                .setColor(selection.status === 'Payé' ? '#00FF00' : '#FFA500');

            const rows = createServiceButtons();

            await interaction.update({ embeds: [embed], components: rows });
        }

        // Boutons de services
        if (interaction.customId.startsWith('service_')) {
            const serviceKey = interaction.customId.replace('service_', '');
            selection.service = SERVICES[serviceKey];
            selections.set(interaction.user.id, selection);

            // Afficher l'état du lobby
            const embed = new EmbedBuilder()
                .setTitle('🎯 État du Lobby')
                .setDescription(`**Membre :** ${selection.member.tag}\n**Statut :** ${selection.status}\n**Service :** ${selection.service.label} - ${selection.service.price}\n\nLe lobby a-t-il été fait ?`)
                .setColor(selection.status === 'Payé' ? '#00FF00' : '#FFA500');

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('lobby_done')
                        .setLabel('Lobby fait')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🟢'),
                    new ButtonBuilder()
                        .setCustomId('lobby_pending')
                        .setLabel('Lobby en attente')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🟠')
                );

            await interaction.update({ embeds: [embed], components: [row] });
        }

        // Boutons d'état du lobby
        if (interaction.customId.startsWith('lobby_')) {
            selection.lobbyState = interaction.customId === 'lobby_done' ? 'Fait' : 'En attente';
            selection.lobbyEmoji = interaction.customId === 'lobby_done' ? '🟢' : '🟠';
            selections.set(interaction.user.id, selection);

            // Envoyer dans le salon queue-lobby
            const queueChannel = await client.channels.fetch(QUEUE_CHANNEL_ID);
            
            const finalEmbed = new EmbedBuilder()
                .setTitle('📋 Nouveau Paiement Enregistré')
                .addFields(
                    { name: '👤 Membre', value: selection.member.tag, inline: false },
                    { name: '💵 Montant', value: selection.status, inline: true },
                    { name: '🎮 Service', value: `${selection.service.label}\n${selection.service.price}`, inline: true },
                    { name: '🎯 État', value: `${selection.lobbyState} ${selection.lobbyEmoji}`, inline: true }
                )
                .setColor(selection.status === 'Payé' ? '#00FF00' : '#FFA500')
                .setTimestamp()
                .setFooter({ text: `Enregistré par ${interaction.user.tag}` });

            const message = await queueChannel.send({ embeds: [finalEmbed] });

            // Boutons de modification avec l'ID du message
            const modifyRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`modify_status_${message.id}`)
                        .setLabel('Modifier Statut')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('💰'),
                    new ButtonBuilder()
                        .setCustomId(`modify_lobby_${message.id}`)
                        .setLabel('Modifier Lobby')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎯')
                );

            await message.edit({ embeds: [finalEmbed], components: [modifyRow] });

            // Stocker les données du paiement
            payments.set(message.id, {
                member: selection.member,
                status: selection.status,
                service: selection.service,
                lobbyState: selection.lobbyState,
                lobbyEmoji: selection.lobbyEmoji,
                messageId: message.id
            });

            // Confirmer à l'utilisateur
            await interaction.update({ 
                content: '✅ Paiement enregistré avec succès dans le salon queue-lobby !',
                embeds: [],
                components: []
            });

            // Nettoyer la sélection
            selections.delete(interaction.user.id);
        }

        // Modification du statut de paiement
        if (interaction.customId.startsWith('modify_status_')) {
            const embed = interaction.message.embeds[0];
            const memberField = embed.fields.find(f => f.name === '👤 Membre');
            const memberTag = memberField ? memberField.value : 'ce membre';

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_status_paid_${interaction.message.id}`)
                        .setLabel('Marquer comme Payé')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                    new ButtonBuilder()
                        .setCustomId(`update_status_pending_${interaction.message.id}`)
                        .setLabel('Marquer en Attente')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⏳')
                );

            await interaction.reply({ 
                content: `Modifier le statut de paiement pour **${memberTag}** :`,
                components: [row],
                ephemeral: true 
            });
        }

        // Modification de l'état du lobby
        if (interaction.customId.startsWith('modify_lobby_')) {
            const embed = interaction.message.embeds[0];
            const memberField = embed.fields.find(f => f.name === '👤 Membre');
            const memberTag = memberField ? memberField.value : 'ce membre';

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`update_lobby_done_${interaction.message.id}`)
                        .setLabel('Marquer Lobby Fait')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🟢'),
                    new ButtonBuilder()
                        .setCustomId(`update_lobby_pending_${interaction.message.id}`)
                        .setLabel('Marquer Lobby en Attente')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🟠')
                );

            await interaction.reply({ 
                content: `Modifier l'état du lobby pour **${memberTag}** :`,
                components: [row],
                ephemeral: true 
            });
        }

        // Mise à jour du statut
        if (interaction.customId.startsWith('update_status_')) {
            const parts = interaction.customId.split('_');
            const messageId = parts[parts.length - 1];
            const newStatus = parts[2] === 'paid' ? 'Payé' : 'En attente';
            
            // Récupérer le message original depuis le canal
            const queueChannel = await client.channels.fetch(QUEUE_CHANNEL_ID);
            const targetMessage = await queueChannel.messages.fetch(messageId);
            
            if (!targetMessage || !targetMessage.embeds[0]) {
                return interaction.update({ content: '❌ Impossible de trouver le message.', components: [] });
            }
            
            const originalEmbed = targetMessage.embeds[0];
            const fields = originalEmbed.data.fields;

            // Mettre à jour le message
            const updatedEmbed = new EmbedBuilder()
                .setTitle('📋 Nouveau Paiement Enregistré')
                .addFields(
                    { name: '👤 Membre', value: fields[0].value, inline: false },
                    { name: '💵 Montant', value: newStatus, inline: true },
                    { name: '🎮 Service', value: fields[2].value, inline: true },
                    { name: '🎯 État', value: fields[3].value, inline: true }
                )
                .setColor(newStatus === 'Payé' ? '#00FF00' : '#FFA500')
                .setTimestamp()
                .setFooter({ text: `Dernière modification par ${interaction.user.tag}` });

            const modifyRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`modify_status_${messageId}`)
                        .setLabel('Modifier Statut')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('💰'),
                    new ButtonBuilder()
                        .setCustomId(`modify_lobby_${messageId}`)
                        .setLabel('Modifier Lobby')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎯')
                );

            await targetMessage.edit({ embeds: [updatedEmbed], components: [modifyRow] });
            await interaction.update({ 
                content: `✅ Statut modifié en **${newStatus}** !`,
                components: []
            });
        }

        // Mise à jour du lobby
        if (interaction.customId.startsWith('update_lobby_')) {
            const parts = interaction.customId.split('_');
            const messageId = parts[parts.length - 1];
            const newLobbyState = parts[2] === 'done' ? 'Fait' : 'En attente';
            const newLobbyEmoji = parts[2] === 'done' ? '🟢' : '🟠';
            
            // Récupérer le message original depuis le canal
            const queueChannel = await client.channels.fetch(QUEUE_CHANNEL_ID);
            const targetMessage = await queueChannel.messages.fetch(messageId);
            
            if (!targetMessage || !targetMessage.embeds[0]) {
                return interaction.update({ content: '❌ Impossible de trouver le message.', components: [] });
            }
            
            const originalEmbed = targetMessage.embeds[0];
            const fields = originalEmbed.data.fields;
            
            // Extraire le statut actuel pour garder la couleur
            const currentStatus = fields[1].value;

            // Mettre à jour le message
            const updatedEmbed = new EmbedBuilder()
                .setTitle('📋 Nouveau Paiement Enregistré')
                .addFields(
                    { name: '👤 Membre', value: fields[0].value, inline: false },
                    { name: '💵 Montant', value: currentStatus, inline: true },
                    { name: '🎮 Service', value: fields[2].value, inline: true },
                    { name: '🎯 État', value: `${newLobbyState} ${newLobbyEmoji}`, inline: true }
                )
                .setColor(currentStatus === 'Payé' ? '#00FF00' : '#FFA500')
                .setTimestamp()
                .setFooter({ text: `Dernière modification par ${interaction.user.tag}` });

            const modifyRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`modify_status_${messageId}`)
                        .setLabel('Modifier Statut')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('💰'),
                    new ButtonBuilder()
                        .setCustomId(`modify_lobby_${messageId}`)
                        .setLabel('Modifier Lobby')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎯')
                );

            await targetMessage.edit({ embeds: [updatedEmbed], components: [modifyRow] });
            await interaction.update({ 
                content: `✅ État du lobby modifié en **${newLobbyState}** ${newLobbyEmoji} !`,
                components: []
            });
        }
    }
});

function createServiceButtons() {
    const buttons1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('service_normal_1')
                .setLabel('Normal - 4€')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('service_hc_1')
                .setLabel('HC - 5€')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('service_normal_3')
                .setLabel('Pack N 3 - 10€')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('service_normal_5')
                .setLabel('Pack N 5 - 15€')
                .setStyle(ButtonStyle.Primary)
        );

    const buttons2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('service_normal_10')
                .setLabel('Pack N 10 - 25€')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('service_normal_20')
                .setLabel('Pack N 20 - 45€')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('service_hc_3')
                .setLabel('Pack HC 3 - 13€')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('service_hc_5')
                .setLabel('Pack HC 5 - 20€')
                .setStyle(ButtonStyle.Danger)
        );

    const buttons3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('service_hc_10')
                .setLabel('Pack HC 10 - 35€')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('service_hc_20')
                .setLabel('Pack HC 20 - 60€')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('service_standard_hour')
                .setLabel('Standard/h - 20€')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('service_hc_hour')
                .setLabel('HC/h - 25€')
                .setStyle(ButtonStyle.Success)
        );

    return [buttons1, buttons2, buttons3];
}

// Gestion des erreurs
client.on('error', error => {
    console.error('❌ Erreur Discord.js:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

// Connexion du bot
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ ERREUR: Variable DISCORD_TOKEN manquante !');
    process.exit(1);
}

client.login(token).catch(error => {
    console.error('❌ Erreur de connexion:', error);
    process.exit(1);
});