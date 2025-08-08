use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("8YpmSCdxjdznYuQtSUpeerjb53iDq4uWW34T9gLF2t2p");

#[program]
pub mod slipless_hook {
    use super::*;

    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let account_metas = vec![ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: "token-badge".as_bytes().to_vec(),
                },
                Seed::AccountData {
                    account_index: 2, // Destination token account index in the transfer ix
                    data_index: 32,   // Offset of owner field in token account data
                    length: 32,       // Length of owner public key
                },
            ],
            false, // is_signer
            false, // is_writable
        )?];

        let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &account_metas)?;

        Ok(())
    }

    pub fn issue_badge(ctx: Context<IssueBadge>) -> Result<()> {
        ctx.accounts.token_badge.authority = ctx.accounts.authority.key();
        ctx.accounts.token_badge.user = ctx.accounts.user.key();
        ctx.accounts.token_badge.issued_at = Clock::get()?.unix_timestamp;
        msg!("TokenBadge issued to user: {}", ctx.accounts.token_badge.user);
        Ok(())
    }

    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        msg!(
            "Transfer hook invoked, checking token badge for user {}",
            ctx.accounts.destination_token.owner
        );
        require_keys_eq!(
            ctx.accounts.token_badge.user,
            ctx.accounts.destination_token.owner,
            SliplessError::InvalidBadgeUser
        );
        msg!("Token badge is valid, transfer allowed");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = payer,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = 8 + ExtraAccountMetaList::size_of(1).unwrap()
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint)]
    pub source_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(token::mint = mint)]
    pub destination_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: The owner of the source token account
    pub owner_delegate: UncheckedAccount<'info>,
    /// CHECK: The extra account meta list, validated by seeds.
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(
        seeds = [b"token-badge", destination_token.owner.as_ref()],
        bump,
    )]
    pub token_badge: Box<Account<'info, TokenBadge>>,
}

#[derive(Accounts)]
pub struct IssueBadge<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The user receiving the badge
    pub user: AccountInfo<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + TokenBadge::INIT_SPACE,
        seeds = [b"token-badge", user.key().as_ref()],
        bump
    )]
    pub token_badge: Account<'info, TokenBadge>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct TokenBadge {
    pub authority: Pubkey,
    pub user: Pubkey,
    pub issued_at: i64,
}

#[error_code]
pub enum SliplessError {
    #[msg("TokenBadge user does not match destination token owner")]
    InvalidBadgeUser,
}
