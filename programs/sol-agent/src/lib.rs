use anchor_lang::prelude::*;

declare_id!("BfKWwCkP8fmvDsWznQXwW5PuvpateF9Nv6X4JMWTVFev");

#[program]
pub mod sol_agent {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
