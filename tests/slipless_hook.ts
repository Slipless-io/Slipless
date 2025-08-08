import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { SliplessHook } from "../target/types/slipless_hook";

describe("slipless_hook", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SliplessHook as Program<SliplessHook>;

  let authority: Signer;
  let recipient: Signer;
  let mint: Signer;
  let authorityATA: PublicKey;
  let recipientATA: PublicKey;
  let extraAccountMetaListPDA: PublicKey;
  let tokenBadgePDA: PublicKey;

  const decimals = 9;

  before(async () => {
    authority = await newAccountWithLamports(provider.connection);
    recipient = await newAccountWithLamports(provider.connection);
    mint = Keypair.generate();

    authorityATA = getAssociatedTokenAddressSync(
      mint.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    recipientATA = getAssociatedTokenAddressSync(
      mint.publicKey,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
      program.programId
    );

    [tokenBadgePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("token-badge"), recipient.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Initializes the mint with transfer hook", async () => {
    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(
      mintLen
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint.publicKey,
        authority.publicKey,
        program.programId,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        authority.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(provider.connection, transaction, [
      authority,
      mint,
    ]);
  });

  it("Initializes the extra account meta list", async () => {
    const tx = await program.methods
      .initializeExtraAccountMetaList()
      .accounts({
        payer: authority.publicKey,
        mint: mint.publicKey,
        extraAccountMetaList: extraAccountMetaListPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log("Initialize extra account meta list tx:", tx);
  });

  it("Issues a token badge to the recipient", async () => {
    const tx = await program.methods
      .issueBadge()
      .accounts({
        authority: authority.publicKey,
        user: recipient.publicKey,
        tokenBadge: tokenBadgePDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    console.log("Issue badge tx:", tx);
  });

  it("Transfers tokens with the transfer hook", async () => {
    // Mint some tokens to the authority
    await sendAndConfirmTransaction(
      provider.connection,
      new Transaction()
        .add(
          createAssociatedTokenAccountInstruction(
            authority.publicKey,
            authorityATA,
            authority.publicKey,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID
          )
        )
        .add(
          createMintToInstruction(
            mint.publicKey,
            authorityATA,
            authority.publicKey,
            100 * 10 ** decimals,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        ),
      [authority]
    );

    // Create the recipient's associated token account
    await sendAndConfirmTransaction(
      provider.connection,
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          recipientATA,
          recipient.publicKey,
          mint.publicKey,
          TOKEN_2022_PROGRAM_ID
        )
      ),
      [authority]
    );

    const transferInstruction =
      await createTransferCheckedWithTransferHookInstruction(
        provider.connection,
        authorityATA,
        mint.publicKey,
        recipientATA,
        authority.publicKey,
        1 * 10 ** decimals,
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

    const transaction = new Transaction().add(transferInstruction);

    const tx = await sendAndConfirmTransaction(provider.connection, transaction, [
      authority,
    ]);
    console.log("Transfer tx:", tx);
  });
});

async function newAccountWithLamports(
  connection: Connection,
  lamports = 1000000000
): Promise<Signer> {
  const account = Keypair.generate();
  const signature = await connection.requestAirdrop(account.publicKey, lamports);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });
  return account;
}
