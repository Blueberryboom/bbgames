const pool = require('./index');

module.exports = async () => {
  try {
    // ─── GIVEAWAYS ─────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS giveaways (
        id VARCHAR(36) PRIMARY KEY,
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        message_id VARCHAR(32) NOT NULL,
        host_id VARCHAR(32) NOT NULL,
        prize TEXT NOT NULL,
        winners INT NOT NULL,
        end_time BIGINT NOT NULL,
        required_role VARCHAR(32) NULL,
        title TEXT NULL,
        extra_entries JSON NULL,
        ended BOOLEAN NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_guild (guild_id),
        INDEX idx_endtime (end_time),
        INDEX idx_ended (ended)
      ) ENGINE=InnoDB;
    `);

    // ─── GIVEAWAY ENTRIES ───────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveaway_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        entry_count INT NOT NULL DEFAULT 1,
        PRIMARY KEY (giveaway_id, user_id),
        INDEX idx_giveaway (giveaway_id)
      ) ENGINE=InnoDB;
    `);



    // ─── GIVEAWAY MIGRATIONS ──────────────
    await pool.query(`
      ALTER TABLE giveaway_entries
      ADD COLUMN IF NOT EXISTS entry_count INT NOT NULL DEFAULT 1
    `);


    // ─── YOUTUBE SUBSCRIPTIONS ─────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS youtube_subscriptions (
        guild_id VARCHAR(32) NOT NULL,
        youtube_channel_id VARCHAR(64) NOT NULL,
        discord_channel_id VARCHAR(32) NOT NULL,
        ping_role_id VARCHAR(32) NULL,
        last_video_id VARCHAR(32) NULL,
        last_checked_at BIGINT NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, youtube_channel_id),
        INDEX idx_yt_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    // ─── WELCOME SETTINGS ─────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS welcome_settings (
        guild_id VARCHAR(32) PRIMARY KEY,
        channel_id VARCHAR(32) NOT NULL,
        message_key VARCHAR(32) NOT NULL,
        image_enabled BOOLEAN NOT NULL DEFAULT 1,
        button_label VARCHAR(80) NULL,
        button_url TEXT NULL,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_welcome_channel (channel_id)
      ) ENGINE=InnoDB;
    `);

    // ─── MEMBER EVENT MESSAGES ────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS member_event_messages (
        guild_id VARCHAR(32) NOT NULL,
        event_type VARCHAR(16) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        message_template TEXT NOT NULL,
        button_label VARCHAR(80) NULL,
        button_url TEXT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, event_type),
        INDEX idx_member_event_channel (channel_id)
      ) ENGINE=InnoDB;
    `);

    // ─── GUILD LOG SETTINGS ───────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guild_logs_settings (
        guild_id VARCHAR(32) PRIMARY KEY,
        channel_id VARCHAR(32) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_guild_logs_channel (channel_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS guild_logs_events (
        guild_id VARCHAR(32) NOT NULL,
        event_key VARCHAR(48) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, event_key)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      INSERT INTO member_event_messages (guild_id, event_type, channel_id, message_template, button_label, button_url, enabled, updated_by, updated_at)
      SELECT guild_id, 'welcome', channel_id, '👋 Welcome [$usermention] to [$guildname]!', button_label, button_url, 1, updated_by, updated_at
      FROM welcome_settings
      ON DUPLICATE KEY UPDATE
        channel_id = VALUES(channel_id),
        button_label = VALUES(button_label),
        button_url = VALUES(button_url),
        updated_by = VALUES(updated_by),
        updated_at = VALUES(updated_at)
    `);

    // ─── STICKY MESSAGES ───────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sticky_messages (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        content TEXT NOT NULL,
        is_embed BOOLEAN NOT NULL DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        cooldown_ms INT NOT NULL DEFAULT 8000,
        last_post_message_id VARCHAR(32) NULL,
        last_post_at BIGINT NULL,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (id),
        UNIQUE KEY uniq_sticky_channel (guild_id, channel_id),
        INDEX idx_sticky_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE sticky_messages
      ADD COLUMN IF NOT EXISTS is_embed BOOLEAN NOT NULL DEFAULT 0
    `);

    await pool.query(`
      ALTER TABLE sticky_messages
      ADD COLUMN IF NOT EXISTS embed_footer_text VARCHAR(2048) NULL
    `);

    await pool.query(`
      ALTER TABLE sticky_messages
      ADD COLUMN IF NOT EXISTS button_label VARCHAR(80) NULL
    `);

    await pool.query(`
      ALTER TABLE sticky_messages
      ADD COLUMN IF NOT EXISTS button_url VARCHAR(512) NULL
    `);


    // ─── AUTO MESSAGES ────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_messages (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        content TEXT NOT NULL,
        interval_ms BIGINT NOT NULL,
        next_run_at BIGINT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (id),
        INDEX idx_automsg_guild (guild_id),
        INDEX idx_automsg_next_run (next_run_at)
      ) ENGINE=InnoDB;
    `);



    // ─── VARIABLE SLOWMODE ───────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS variable_slowmode_configs (
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        min_slowmode INT NOT NULL,
        max_slowmode INT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, channel_id),
        INDEX idx_vs_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    // ─── EVENT ADMIN ROLES ──────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_roles (
        guild_id VARCHAR(32) NOT NULL,
        role_id VARCHAR(32) NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS giveaway_admin_roles (
        guild_id VARCHAR(32) NOT NULL,
        role_id VARCHAR(32) NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_roles (
        guild_id VARCHAR(32) NOT NULL,
        role_id VARCHAR(32) NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      ) ENGINE=InnoDB;
    `);

    // ─── COUNTING SYSTEM ────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS counting (
        guild_id VARCHAR(32) PRIMARY KEY,
        channel_id VARCHAR(32),
        current INT DEFAULT 0,
        last_user VARCHAR(32),
        announcements_enabled BOOLEAN NOT NULL DEFAULT 1
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE counting
      ADD COLUMN IF NOT EXISTS announcements_enabled BOOLEAN NOT NULL DEFAULT 1
    `);


    // ─── SUPPORT REQUESTS ───────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_requests (
        id BIGINT NOT NULL AUTO_INCREMENT,
        user_id VARCHAR(32) NOT NULL,
        guild_id VARCHAR(32) NOT NULL,
        category VARCHAR(32) NOT NULL,
        message TEXT NOT NULL,
        owner_reply TEXT NULL,
        replied_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_support_user (user_id),
        INDEX idx_support_created (created_at)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE counting
      ADD COLUMN IF NOT EXISTS announcements_enabled BOOLEAN NOT NULL DEFAULT 1
    `);

    // ─── TICKETS ───────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_settings (
        guild_id VARCHAR(32) PRIMARY KEY,
        category_id VARCHAR(32) NULL,
        transcripts_channel_id VARCHAR(32) NULL,
        workload_channel_id VARCHAR(32) NULL,
        workload_message_id VARCHAR(32) NULL,
        max_tickets_per_user TINYINT NOT NULL DEFAULT 1,
        panel_message TEXT NULL,
        claiming_enabled BOOLEAN NOT NULL DEFAULT 1,
        creation_cooldown_ms BIGINT NOT NULL DEFAULT 0,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE ticket_settings
      ADD COLUMN IF NOT EXISTS workload_channel_id VARCHAR(32) NULL
    `);

    await pool.query(`
      ALTER TABLE ticket_settings
      ADD COLUMN IF NOT EXISTS workload_message_id VARCHAR(32) NULL
    `);

    await pool.query(`
      ALTER TABLE ticket_settings
      ADD COLUMN IF NOT EXISTS next_ticket_display_id BIGINT NOT NULL DEFAULT 1
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_types (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(60) NULL,
        prefix VARCHAR(8) NOT NULL DEFAULT 'TICKET',
        allowed_role_ids JSON NULL,
        staff_role_ids JSON NOT NULL,
        welcome_message TEXT NOT NULL,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (id),
        UNIQUE KEY uniq_ticket_type_name (guild_id, name),
        INDEX idx_ticket_types_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE ticket_types
      ADD COLUMN IF NOT EXISTS description VARCHAR(60) NULL
    `);

    await pool.query(`
      ALTER TABLE ticket_types
      ADD COLUMN IF NOT EXISTS prefix VARCHAR(8) NOT NULL DEFAULT 'TICKET'
    `);

    await pool.query(`
      UPDATE ticket_types
      SET prefix = UPPER(LEFT(REGEXP_REPLACE(COALESCE(prefix, name, 'TICKET'), '[^A-Za-z0-9-]', ''), 8))
      WHERE prefix IS NULL OR prefix = '' OR prefix REGEXP '[^A-Za-z0-9-]'
    `).catch(() => null);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        type_id BIGINT NOT NULL,
        claimed_by VARCHAR(32) NULL,
        transcript_thread_id VARCHAR(32) NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_ticket_channel (channel_id),
        INDEX idx_ticket_guild_user (guild_id, user_id),
        INDEX idx_ticket_type (guild_id, type_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS transcript_thread_id VARCHAR(32) NULL
    `);

    await pool.query(`
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS display_id BIGINT NULL
    `);

    await pool.query(`
      UPDATE tickets
      SET display_id = id
      WHERE display_id IS NULL
    `);

    await pool.query(`
      ALTER TABLE tickets
      MODIFY COLUMN display_id BIGINT NOT NULL
    `);

    await pool.query(`
      ALTER TABLE tickets
      ADD UNIQUE INDEX IF NOT EXISTS uniq_ticket_display_id (guild_id, display_id)
    `);

    await pool.query(`
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS last_activity_at BIGINT NULL
    `);

    await pool.query(`
      UPDATE tickets
      SET last_activity_at = created_at
      WHERE last_activity_at IS NULL
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_automations (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        name VARCHAR(64) NOT NULL,
        ticket_type_id BIGINT NOT NULL,
        trigger_mode ENUM('time','time_without_message') NOT NULL,
        duration_ms BIGINT NOT NULL,
        action_type ENUM('send_message','send_close_request','close','send_alert') NOT NULL,
        action_message TEXT NULL,
        disabled_until BIGINT NULL,
        created_by VARCHAR(32) NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_ticket_automation_name (guild_id, name),
        INDEX idx_ticket_automation_guild (guild_id),
        INDEX idx_ticket_automation_type (guild_id, ticket_type_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_automation_close_requests (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        ticket_id BIGINT NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        automation_name VARCHAR(64) NOT NULL,
        expires_at BIGINT NOT NULL,
        resolved BOOLEAN NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_ticket_automation_close_expiry (expires_at),
        INDEX idx_ticket_automation_close_ticket (ticket_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_blacklist (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        created_by VARCHAR(32) NULL,
        PRIMARY KEY (guild_id, user_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_user_activity (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        last_opened_at BIGINT NOT NULL,
        PRIMARY KEY (guild_id, user_id),
        INDEX idx_ticket_user_activity (guild_id, last_opened_at)
      ) ENGINE=InnoDB;
    `);

    // ─── SUGGESTIONS ───────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suggestion_settings (
        guild_id VARCHAR(32) PRIMARY KEY,
        channel_id VARCHAR(32) NOT NULL,
        panel_channel_id VARCHAR(32) NULL,
        ping_role_id VARCHAR(32) NULL,
        create_thread BOOLEAN NOT NULL DEFAULT 1,
        allowed_role_ids JSON NULL,
        cooldown_ms BIGINT NOT NULL DEFAULT 0,
        disabled_until BIGINT NULL,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE suggestion_settings
      ADD COLUMN IF NOT EXISTS ping_role_id VARCHAR(32) NULL
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS suggestion_categories (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        name VARCHAR(80) NOT NULL,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (id),
        UNIQUE KEY uniq_suggestion_category (guild_id, name),
        INDEX idx_suggestion_categories_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS suggestion_blacklist (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        created_by VARCHAR(32) NULL,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, user_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS suggestion_user_activity (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        last_suggested_at BIGINT NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS suggestions (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        message_id VARCHAR(32) NOT NULL,
        thread_id VARCHAR(32) NULL,
        author_id VARCHAR(32) NOT NULL,
        title VARCHAR(120) NOT NULL,
        description TEXT NOT NULL,
        category_name VARCHAR(80) NULL,
        status ENUM('na', 'accepted', 'denied', 'considering') NOT NULL DEFAULT 'na',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        stale_marked_at BIGINT NULL,
        stale_exempt BOOLEAN NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (id),
        UNIQUE KEY uniq_suggestion_message (guild_id, message_id),
        INDEX idx_suggestions_guild (guild_id),
        INDEX idx_suggestions_author (guild_id, author_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE suggestions
      ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000)
    `);

    await pool.query(`
      ALTER TABLE suggestions
      ADD COLUMN IF NOT EXISTS stale_marked_at BIGINT NULL
    `);

    await pool.query(`
      ALTER TABLE suggestions
      ADD COLUMN IF NOT EXISTS stale_exempt BOOLEAN NOT NULL DEFAULT 0
    `);


    // ─── PREMIUM ACCESS CONTROL ────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS premium_allowed_users (
        user_id VARCHAR(32) PRIMARY KEY,
        added_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        source VARCHAR(16) NOT NULL DEFAULT 'manual',
        expires_at BIGINT NULL,
        notified_at BIGINT NULL
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE premium_allowed_users
      ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual'
    `);

    await pool.query(`
      ALTER TABLE premium_allowed_users
      ADD COLUMN IF NOT EXISTS expires_at BIGINT NULL
    `);

    await pool.query(`
      ALTER TABLE premium_allowed_users
      ADD COLUMN IF NOT EXISTS notified_at BIGINT NULL
    `);



    // ─── PREMIUM GUILD PERKS ──────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS premium_guild_perks (
        guild_id VARCHAR(32) PRIMARY KEY,
        owner_user_id VARCHAR(32) NOT NULL,
        source_user_id VARCHAR(32) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT 1,
        grace_expires_at BIGINT NULL,
        notified_at BIGINT NULL,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_perks_owner (owner_user_id),
        INDEX idx_perks_source (source_user_id),
        INDEX idx_perks_grace (grace_expires_at)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE premium_guild_perks
      ADD COLUMN IF NOT EXISTS grace_expires_at BIGINT NULL
    `);

    await pool.query(`
      ALTER TABLE premium_guild_perks
      ADD COLUMN IF NOT EXISTS notified_at BIGINT NULL
    `);



    await pool.query(`
      ALTER TABLE premium_guild_perks
      ADD COLUMN IF NOT EXISTS source_type VARCHAR(16) NOT NULL DEFAULT 'role'
    `);

    await pool.query(`
      ALTER TABLE premium_guild_perks
      ADD COLUMN IF NOT EXISTS code VARCHAR(64) NULL
    `);

    await pool.query(`
      ALTER TABLE premium_guild_perks
      ADD COLUMN IF NOT EXISTS expires_at BIGINT NULL
    `);

    // ─── PREMIUM CODES ─────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS premium_codes (
        code VARCHAR(64) PRIMARY KEY,
        duration_type VARCHAR(16) NOT NULL,
        created_by VARCHAR(32) NOT NULL,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        deleted_at BIGINT NULL,
        redeemed_by_user_id VARCHAR(32) NULL,
        redeemed_guild_id VARCHAR(32) NULL,
        redeemed_at BIGINT NULL,
        expires_at BIGINT NULL,
        INDEX idx_premium_codes_deleted (deleted_at),
        INDEX idx_premium_codes_redeemed (redeemed_by_user_id)
      ) ENGINE=InnoDB;
    `);

    // ─── PREMIUM INSTANCES ─────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS premium_instances (
        instance_id VARCHAR(80) PRIMARY KEY,
        owner_id VARCHAR(32) NOT NULL,
        bot_user_id VARCHAR(32) NULL,
        token TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        status_one VARCHAR(128) NULL,
        status_two VARCHAR(128) NULL,
        INDEX idx_premium_instances_owner (owner_id),
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE premium_instances
      ADD COLUMN IF NOT EXISTS instance_id VARCHAR(80) NULL
    `);

    await pool.query(`
      ALTER TABLE premium_instances
      ADD COLUMN IF NOT EXISTS bot_user_id VARCHAR(32) NULL
    `);

    await pool.query(`
      ALTER TABLE premium_instances
      ADD COLUMN IF NOT EXISTS status_one VARCHAR(128) NULL
    `);

    await pool.query(`
      ALTER TABLE premium_instances
      ADD COLUMN IF NOT EXISTS status_two VARCHAR(128) NULL
    `);

    await pool.query(`
      UPDATE premium_instances
      SET instance_id = CONCAT(owner_id, ':default')
      WHERE instance_id IS NULL OR instance_id = ''
    `);

    await pool.query(`
      ALTER TABLE premium_instances
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (instance_id)
    `).catch(() => {});

    await pool.query(`
      ALTER TABLE premium_instances
      ADD INDEX idx_premium_instances_owner (owner_id)
    `).catch(() => {});


    // ─── LEVELING SETTINGS ────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leveling_settings (
        guild_id VARCHAR(32) PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        levelup_channel_id VARCHAR(32) NULL,
        difficulty TINYINT NOT NULL DEFAULT 3,
        boost_role_ids TEXT NULL,
        channel_mode VARCHAR(16) NULL,
        channel_ids TEXT NULL,
        message_with_role VARCHAR(160) NOT NULL DEFAULT 'Congrats, {user}, you leveled up to **{level}**! You now have the {role}!',
        message_without_role VARCHAR(160) NOT NULL DEFAULT 'Congrats, {user}, you leveled up to **{level}**!',
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_levelup_channel (levelup_channel_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE leveling_settings
      ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT 1
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leveling_users (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        xp BIGINT NOT NULL DEFAULT 0,
        level INT NOT NULL DEFAULT 0,
        last_xp_at BIGINT NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, user_id),
        INDEX idx_level_guild (guild_id),
        INDEX idx_level_rank (guild_id, level, xp)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leveling_role_rewards (
        guild_id VARCHAR(32) NOT NULL,
        level_required INT NOT NULL,
        role_id VARCHAR(32) NOT NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, level_required),
        UNIQUE KEY uniq_leveling_role_once (guild_id, role_id)
      ) ENGINE=InnoDB;
    `);

    // ─── AFK SYSTEM ───────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS afk_status (
        user_id VARCHAR(32) PRIMARY KEY,
        guild_id VARCHAR(32) NOT NULL,
        reason VARCHAR(200) NOT NULL,
        only_this_server BOOLEAN NOT NULL DEFAULT 1,
        started_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_afk_guild (guild_id),
        INDEX idx_afk_started (started_at)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS afk_leaderboard (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        longest_afk_ms BIGINT NOT NULL DEFAULT 0,
        total_afk_ms BIGINT NOT NULL DEFAULT 0,
        afk_sessions BIGINT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, user_id),
        INDEX idx_afk_lb_rank (guild_id, longest_afk_ms)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE afk_leaderboard
      ADD COLUMN IF NOT EXISTS total_afk_ms BIGINT NOT NULL DEFAULT 0
    `);

    await pool.query(`
      ALTER TABLE afk_leaderboard
      ADD COLUMN IF NOT EXISTS afk_sessions BIGINT NOT NULL DEFAULT 0
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS afk_user_activity (
        user_id VARCHAR(32) PRIMARY KEY,
        last_online_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_afk_activity_online (last_online_at)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS leveling_xp_events (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        xp_gained INT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_xp_guild_time (guild_id, created_at),
        INDEX idx_xp_user (guild_id, user_id)
      ) ENGINE=InnoDB;
    `);

    // ─── BIRTHDAY SYSTEM ──────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS birthday_settings (
        guild_id VARCHAR(32) PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        channel_id VARCHAR(32) NOT NULL,
        allowed_role_ids TEXT NULL,
        updated_by VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_birthday_channel (channel_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS birthday_users (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        day TINYINT NOT NULL,
        month TINYINT NOT NULL,
        last_changed_at BIGINT NOT NULL,
        last_announced_year SMALLINT NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, user_id),
        INDEX idx_birthday_lookup (guild_id, month, day),
        INDEX idx_birthday_user (user_id)
      ) ENGINE=InnoDB;
    `);

    // ─── GUILD DATA DELETION QUEUE ─────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS guild_deletion_queue (
        guild_id VARCHAR(32) PRIMARY KEY,
        delete_after BIGINT NOT NULL,
        reason VARCHAR(32) NULL,
        queued_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_delete_after (delete_after)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS guild_data_deletion_approvals (
        guild_id VARCHAR(32) PRIMARY KEY,
        approved_by VARCHAR(32) NOT NULL,
        approved_at BIGINT NOT NULL,
        INDEX idx_data_deletion_approved_at (approved_at)
      ) ENGINE=InnoDB;
    `);

    // ─── BLACKLIST ─────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blacklist (
        guild_id VARCHAR(32) PRIMARY KEY,
        added_at BIGINT NOT NULL
      ) ENGINE=InnoDB;
    `);

    // ─── COUNTING LEADERBOARD ──────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS counting_leaderboard (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        score INT DEFAULT 0,
        fails INT DEFAULT 0,
        PRIMARY KEY (guild_id, user_id),
        INDEX idx_lb_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    // ─── TAG SYSTEM ────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tags (
        guild_id VARCHAR(32) NOT NULL,
        tag_name VARCHAR(40) NOT NULL,
        content TEXT NOT NULL,
        created_by VARCHAR(32) NOT NULL,
        expires_after_seconds INT NOT NULL DEFAULT 0,
        send_mode VARCHAR(16) NOT NULL DEFAULT 'admins',
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, tag_name),
        INDEX idx_tags_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE tags
      ADD COLUMN IF NOT EXISTS expires_after_seconds INT NOT NULL DEFAULT 0
    `);

    await pool.query(`
      ALTER TABLE tags
      ADD COLUMN IF NOT EXISTS send_mode VARCHAR(16) NOT NULL DEFAULT 'admins'
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tag_allowed_roles (
        guild_id VARCHAR(32) NOT NULL,
        tag_name VARCHAR(40) NOT NULL DEFAULT '',
        role_id VARCHAR(32) NOT NULL,
        PRIMARY KEY (guild_id, role_id, tag_name)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      ALTER TABLE tag_allowed_roles
      ADD COLUMN IF NOT EXISTS tag_name VARCHAR(40) NOT NULL DEFAULT ''
    `);

    await pool.query(`
      ALTER TABLE tag_allowed_roles
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (guild_id, role_id, tag_name)
    `).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tag_usage_stats (
        guild_id VARCHAR(32) NOT NULL,
        tag_name VARCHAR(40) NOT NULL,
        used_at BIGINT NOT NULL,
        INDEX idx_tag_usage_guild (guild_id),
        INDEX idx_tag_usage_name (guild_id, tag_name),
        INDEX idx_tag_usage_time (guild_id, used_at)
      ) ENGINE=InnoDB;
    `);

    // ─── ONE WORD STORY ────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS one_word_story_settings (
        guild_id VARCHAR(32) PRIMARY KEY,
        channel_id VARCHAR(32) NULL,
        story_text LONGTEXT NOT NULL,
        word_count INT NOT NULL DEFAULT 0,
        last_user_id VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_story_channel (channel_id)
      ) ENGINE=InnoDB;
    `);


    await pool.query(`
      ALTER TABLE one_word_story_settings
      ADD COLUMN IF NOT EXISTS process_delay_seconds INT NOT NULL DEFAULT 5
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS one_word_story_contributions (
        guild_id VARCHAR(32) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        message_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        stars INT NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (guild_id, message_id),
        INDEX idx_ows_contrib_user (guild_id, user_id),
        INDEX idx_ows_contrib_channel (guild_id, channel_id)
      ) ENGINE=InnoDB;
    `);


    // ─── STARBOARD ───────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS starboard_configs (
        id BIGINT NOT NULL AUTO_INCREMENT,
        guild_id VARCHAR(32) NOT NULL,
        name VARCHAR(40) NOT NULL,
        channel_id VARCHAR(32) NOT NULL,
        reaction_emoji VARCHAR(96) NOT NULL,
        min_reactions INT NOT NULL DEFAULT 3,
        embed_color INT NULL,
        created_by VARCHAR(32) NOT NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (id),
        UNIQUE KEY uniq_starboard_name (guild_id, name),
        INDEX idx_starboard_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS starboard_posts (
        guild_id VARCHAR(32) NOT NULL,
        config_id BIGINT NOT NULL,
        source_channel_id VARCHAR(32) NOT NULL,
        source_message_id VARCHAR(32) NOT NULL,
        starboard_message_id VARCHAR(32) NOT NULL,
        last_count INT NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, config_id, source_message_id),
        UNIQUE KEY uniq_starboard_post_message (starboard_message_id),
        INDEX idx_starboard_posts_guild (guild_id)
      ) ENGINE=InnoDB;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS starboard_banned_users (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (guild_id, user_id)
      ) ENGINE=InnoDB;
    `);

    // ─── SERVER TAG REWARDS ──────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS servertag_reward_settings (
        guild_id VARCHAR(32) PRIMARY KEY,
        role_id VARCHAR(32) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000)
      ) ENGINE=InnoDB;
    `);

    // ─── ACHIEVEMENTS ─────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS achievements_progress (
        user_id VARCHAR(32) NOT NULL,
        achievement_key VARCHAR(64) NOT NULL,
        progress BIGINT NOT NULL DEFAULT 0,
        unlocked_at BIGINT NULL,
        unlocked_guild_id VARCHAR(32) NULL,
        unlocked_channel_id VARCHAR(32) NULL,
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        PRIMARY KEY (user_id, achievement_key),
        INDEX idx_achievements_user (user_id),
        INDEX idx_achievements_unlocked (unlocked_at)
      ) ENGINE=InnoDB;
    `);

    console.log("✅ Database setup complete!");
  } catch (err) {
    console.error("❌ Error setting up database:", err);
  }
};
