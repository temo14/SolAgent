use anchor_lang::prelude::*;

declare_id!("DaHkJdyABu8qfVXbxMmzSuNh59V3iZaQvD5niMcC3ak5");

#[program]
pub mod archon {
    use super::*;

    /// User creates a Mandate PDA that authorises `delegate` to spend on their behalf
    /// within the limits defined here. The chain enforces these limits — not the server.
    pub fn create_mandate(
        ctx: Context<CreateMandate>,
        params: CreateMandateParams,
    ) -> Result<()> {
        let mandate = &mut ctx.accounts.mandate;
        mandate.owner = ctx.accounts.owner.key();
        mandate.delegate = params.delegate;
        mandate.max_per_tx_lamports = params.max_per_tx_lamports;
        mandate.max_per_day_lamports = params.max_per_day_lamports;
        mandate.spent_today_lamports = 0;
        mandate.day_reset_ts = Clock::get()?.unix_timestamp;
        mandate.total_executions = 0;
        mandate.is_active = true;
        mandate.expires_at = params.expires_at;
        mandate.bump = ctx.bumps.mandate;
        Ok(())
    }

    /// Owner can update limits at any time (tighten or loosen).
    pub fn update_mandate(
        ctx: Context<UpdateMandate>,
        params: UpdateMandateParams,
    ) -> Result<()> {
        let mandate = &mut ctx.accounts.mandate;
        mandate.max_per_tx_lamports = params.max_per_tx_lamports;
        mandate.max_per_day_lamports = params.max_per_day_lamports;
        mandate.expires_at = params.expires_at;
        Ok(())
    }

    /// Owner kills all automation instantly — no server permission needed.
    pub fn revoke_mandate(ctx: Context<RevokeMandate>) -> Result<()> {
        ctx.accounts.mandate.is_active = false;
        Ok(())
    }

    /// Called by execution engine BEFORE the actual swap/transfer instruction.
    /// Validates per-tx and daily limits, increments daily spend counter.
    /// Signer MUST be mandate.delegate (Archon's agent wallet).
    /// If this instruction fails the entire transaction fails atomically.
    pub fn record_execution(
        ctx: Context<RecordExecution>,
        amount_lamports: u64,
    ) -> Result<()> {
        let mandate = &mut ctx.accounts.mandate;
        let clock = Clock::get()?;

        require!(mandate.is_active, ArchonError::MandateRevoked);
        require!(
            mandate.expires_at == 0 || clock.unix_timestamp < mandate.expires_at,
            ArchonError::MandateExpired
        );
        require!(
            amount_lamports <= mandate.max_per_tx_lamports,
            ArchonError::ExceedsPerTxLimit
        );

        // Reset daily counter after a rolling 24-hour window from last reset.
        if clock.unix_timestamp >= mandate.day_reset_ts + 86_400 {
            mandate.spent_today_lamports = 0;
            mandate.day_reset_ts = clock.unix_timestamp;
        }

        require!(
            mandate.spent_today_lamports.saturating_add(amount_lamports)
                <= mandate.max_per_day_lamports,
            ArchonError::ExceedsDailyLimit
        );

        mandate.spent_today_lamports = mandate
            .spent_today_lamports
            .saturating_add(amount_lamports);
        mandate.total_executions = mandate.total_executions.saturating_add(1);
        Ok(())
    }
}

// ─── Account structs ──────────────────────────────────────────────────────────

#[account]
pub struct Mandate {
    pub owner: Pubkey,                // 32
    pub delegate: Pubkey,             // 32
    pub max_per_tx_lamports: u64,     // 8
    pub max_per_day_lamports: u64,    // 8
    pub spent_today_lamports: u64,    // 8
    pub day_reset_ts: i64,            // 8
    pub total_executions: u64,        // 8
    pub is_active: bool,              // 1
    pub expires_at: i64,              // 8   (0 = no expiry)
    pub bump: u8,                     // 1
} // 114 bytes data + 8 discriminator = 122 bytes

// PDA seeds: [b"mandate", owner.key().as_ref()]

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMandateParams {
    pub delegate: Pubkey,
    pub max_per_tx_lamports: u64,
    pub max_per_day_lamports: u64,
    pub expires_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateMandateParams {
    pub max_per_tx_lamports: u64,
    pub max_per_day_lamports: u64,
    pub expires_at: i64,
}

// ─── Contexts ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CreateMandate<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 114,
        seeds = [b"mandate", owner.key().as_ref()],
        bump
    )]
    pub mandate: Account<'info, Mandate>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMandate<'info> {
    #[account(
        mut,
        seeds = [b"mandate", owner.key().as_ref()],
        bump = mandate.bump,
        has_one = owner
    )]
    pub mandate: Account<'info, Mandate>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RevokeMandate<'info> {
    #[account(
        mut,
        seeds = [b"mandate", owner.key().as_ref()],
        bump = mandate.bump,
        has_one = owner
    )]
    pub mandate: Account<'info, Mandate>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordExecution<'info> {
    #[account(
        mut,
        seeds = [b"mandate", mandate.owner.as_ref()],
        bump = mandate.bump,
        constraint = mandate.delegate == delegate.key() @ ArchonError::Unauthorized
    )]
    pub mandate: Account<'info, Mandate>,
    pub delegate: Signer<'info>,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum ArchonError {
    #[msg("Mandate has been revoked by the owner")]
    MandateRevoked,
    #[msg("Mandate has expired")]
    MandateExpired,
    #[msg("Signer is not the authorised delegate")]
    Unauthorized,
    #[msg("Amount exceeds the per-transaction limit")]
    ExceedsPerTxLimit,
    #[msg("Amount would exceed the daily spend limit")]
    ExceedsDailyLimit,
}
