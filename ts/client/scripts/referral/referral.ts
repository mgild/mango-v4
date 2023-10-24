import {
  AnchorProvider,
  IdlAccounts,
  Program,
  Wallet,
} from '@coral-xyz/anchor';
import {
  AccountLayout,
  RawAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Connection,
  GetProgramAccountsFilter,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  TransactionSignature,
  VersionedTransaction,
} from '@solana/web3.js';
import fs from 'fs';
import chunk from 'lodash/chunk';

import { PROGRAM_ID } from './constant';
import { IDL, Referral } from './idl';
import { getOrCreateATAInstruction } from './utils';

export interface InitializeProjectVariable {
  adminPubKey: PublicKey;
  basePubKey: PublicKey;
  name: string;
  defaultShareBps: number;
}

export interface TransferProjectVariable {
  newAdminPubKey: PublicKey;
  projectPubKey: PublicKey;
}

export interface InitializeReferralAccountVariable {
  projectPubKey: PublicKey;
  partnerPubKey: PublicKey;
  payerPubKey: PublicKey;
  referralAccountPubKey: PublicKey;
}

export interface InitializeReferralAccountWithNameVariable {
  projectPubKey: PublicKey;
  partnerPubKey: PublicKey;
  payerPubKey: PublicKey;
  name: string;
}

export interface TransferReferralAccountVariable {
  newPartnerPubKey: PublicKey;
  referralAccountPubKey: PublicKey;
}

export interface GetReferralAccountPubkeyVariable {
  projectPubKey: PublicKey;
  name: string;
}

export interface GetReferralTokenAccountPubkeyVariable {
  referralAccountPubKey: PublicKey;
  mint: PublicKey;
}

export interface InitializeReferralTokenAccountVariable {
  payerPubKey: PublicKey;
  referralAccountPubKey: PublicKey;
  mint: PublicKey;
}

export interface ClaimVariable {
  payerPubKey: PublicKey;
  referralAccountPubKey: PublicKey;
  mint: PublicKey;
}

export interface ClaimAllVariable {
  payerPubKey: PublicKey;
  referralAccountPubKey: PublicKey;
}

export interface RawAccountWithPubkey {
  pubkey: PublicKey;
  account: RawAccount;
}

export const useReferral = (connection: Connection) => {
  return new ReferralProvider(connection);
};

export class ReferralProvider {
  private program: Program<Referral>;
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;

    const admin = Keypair.fromSecretKey(
      Buffer.from(
        JSON.parse(fs.readFileSync(process.env.MB_PAYER_KEYPAIR!, 'utf-8')),
      ),
    );

    console.log(admin.publicKey);

    const options = AnchorProvider.defaultOptions();
    const adminWallet = new Wallet(admin);
    console.log(`Admin ${adminWallet.publicKey.toBase58()}`);
    const provider = new AnchorProvider(connection, adminWallet, options);

    this.program = new Program(IDL, PROGRAM_ID, provider);
  }

  public async getProjects(filters: GetProgramAccountsFilter[] = []) {
    return await this.program.account.project.all(filters);
  }

  public async getProject(pubkey: PublicKey) {
    return await this.program.account.project.fetch(pubkey);
  }

  public async getReferralAccount(pubkey: PublicKey) {
    return await this.program.account.referralAccount.fetch(pubkey);
  }

  public async getReferralAccounts(filters: GetProgramAccountsFilter[] = []) {
    return await this.program.account.referralAccount.all(filters);
  }

  public getProjectAuthorityPubKey(
    project: IdlAccounts<Referral>['project'],
  ): PublicKey {
    let [projectAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('project_authority'), project.base.toBuffer()],
      this.program.programId,
    );

    return projectAuthority;
  }

  public getReferralAccountWithNamePubKey({
    projectPubKey,
    name,
  }: GetReferralAccountPubkeyVariable) {
    const [referralAccountPubKey] = PublicKey.findProgramAddressSync(
      [Buffer.from('referral'), projectPubKey.toBuffer(), Buffer.from(name)],
      this.program.programId,
    );

    return referralAccountPubKey;
  }

  public getReferralTokenAccountPubKey({
    referralAccountPubKey,
    mint,
  }: GetReferralTokenAccountPubkeyVariable) {
    const [referralTokenAccountPubKey] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('referral_ata'),
        referralAccountPubKey.toBuffer(),
        mint.toBuffer(),
      ],
      this.program.programId,
    );

    return referralTokenAccountPubKey;
  }

  public async getReferralTokenAccounts(
    referralAccountAddress: string,
  ): Promise<{
    tokenAccounts: RawAccountWithPubkey[];
    token2022Accounts: RawAccountWithPubkey[];
  }> {
    const referralAccount = await this.program.account.referralAccount.fetch(
      new PublicKey(referralAccountAddress),
    );

    const [tokenAccounts, token2022Accounts] = await Promise.all(
      [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(async (programId) => {
        const mintSet = new Set();
        const possibleTokenAccountSet = new Set<string>();
        const tokenAccountMap = new Map<string, RawAccount>();

        // get all token accounts belong to project
        const allTokenAccounts = await this.connection.getTokenAccountsByOwner(
          referralAccount.project,
          { programId },
        );

        // get unique mint and all token accounts
        allTokenAccounts.value.map((tokenAccount) => {
          const accountData = AccountLayout.decode(tokenAccount.account.data);

          if (!mintSet.has(accountData.mint.toBase58())) {
            const address = this.getReferralTokenAccountPubKey({
              referralAccountPubKey: new PublicKey(referralAccountAddress),
              mint: accountData.mint,
            });
            mintSet.add(accountData.mint.toBase58());
            possibleTokenAccountSet.add(address.toBase58());
          }

          tokenAccountMap.set(tokenAccount.pubkey.toBase58(), accountData);
        });

        // loop through mint and find token account belong to referral account
        return Array.from(possibleTokenAccountSet).reduce((acc, address) => {
          const tokenAccount = tokenAccountMap.get(address);
          if (tokenAccount) {
            acc.push({ pubkey: new PublicKey(address), account: tokenAccount });
          }

          return acc;
        }, [] as RawAccountWithPubkey[]);
      }),
    );

    return { tokenAccounts, token2022Accounts };
  }

  public async initializeProject({
    basePubKey,
    adminPubKey,
    name,
    defaultShareBps,
  }: InitializeProjectVariable): Promise<TransactionSignature> {
    const [projectPubKey] = PublicKey.findProgramAddressSync(
      [Buffer.from('project'), basePubKey.toBuffer()],
      this.program.programId,
    );

    return await this.program.methods
      .initializeProject({ name, defaultShareBps })
      .accounts({
        admin: adminPubKey,
        project: projectPubKey,
        base: basePubKey,
      })
      .rpc();
  }

  public async transferProject({
    newAdminPubKey,
    projectPubKey,
  }: TransferProjectVariable): Promise<Transaction> {
    const project = await this.program.account.project.fetch(projectPubKey);

    return await this.program.methods
      .transferProject({})
      .accounts({
        admin: project.admin,
        project: projectPubKey,
        newAdmin: newAdminPubKey,
      })
      .transaction();
  }

  public async initializeReferralAccount({
    projectPubKey,
    partnerPubKey,
    payerPubKey,
    referralAccountPubKey,
  }: InitializeReferralAccountVariable): Promise<Transaction> {
    return await this.program.methods
      .initializeReferralAccount({})
      .accounts({
        project: projectPubKey,
        partner: partnerPubKey,
        referralAccount: referralAccountPubKey,
        payer: payerPubKey,
      })
      .transaction();
  }

  public async initializeReferralAccountWithName({
    projectPubKey,
    partnerPubKey,
    payerPubKey,
    name,
  }: InitializeReferralAccountWithNameVariable): Promise<{
    tx: Transaction;
    referralAccountPubKey: PublicKey;
  }> {
    const referralAccountPubKey = this.getReferralAccountWithNamePubKey({
      projectPubKey,
      name,
    });

    const tx = await this.program.methods
      .initializeReferralAccountWithName({ name })
      .accounts({
        project: projectPubKey,
        partner: partnerPubKey,
        referralAccount: referralAccountPubKey,
        payer: payerPubKey,
      })
      .transaction();

    return { tx, referralAccountPubKey };
  }

  public async transferReferralAccount({
    newPartnerPubKey,
    referralAccountPubKey,
  }: TransferReferralAccountVariable): Promise<Transaction> {
    const referralAccount = await this.program.account.referralAccount.fetch(
      referralAccountPubKey,
    );

    return await this.program.methods
      .transferReferralAccount({})
      .accounts({
        partner: referralAccount.partner,
        newPartner: newPartnerPubKey,
        referralAccount: referralAccountPubKey,
      })
      .transaction();
  }

  public async initializeReferralTokenAccount({
    payerPubKey,
    referralAccountPubKey,
    mint,
  }: InitializeReferralTokenAccountVariable): Promise<{
    tx: Transaction;
    referralTokenAccountPubKey: PublicKey;
  }> {
    const mintAccount = await this.connection.getAccountInfo(mint);
    if (!mintAccount) throw new Error('Invalid mint');

    if (
      ![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((id) =>
        id.equals(mintAccount.owner),
      )
    )
      throw new Error('Invalid mint');

    const referralAccount = await this.program.account.referralAccount.fetch(
      referralAccountPubKey,
    );

    const referralTokenAccountPubKey = this.getReferralTokenAccountPubKey({
      referralAccountPubKey,
      mint,
    });

    const tx = await this.program.methods
      .initializeReferralTokenAccount()
      .accounts({
        payer: payerPubKey,
        project: referralAccount.project,
        referralAccount: referralAccountPubKey,
        referralTokenAccount: referralTokenAccountPubKey,
        mint,
        tokenProgram: mintAccount.owner,
      })
      .transaction();

    return { tx, referralTokenAccountPubKey };
  }

  public async claim({
    payerPubKey,
    referralAccountPubKey,
    mint,
  }: ClaimVariable): Promise<Transaction> {
    const mintAccount = await this.connection.getAccountInfo(mint);
    if (!mintAccount) throw new Error('Invalid mint');

    if (
      ![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some((id) =>
        id.equals(mintAccount.owner),
      )
    )
      throw new Error('Invalid mint');

    const referralAccount = await this.program.account.referralAccount.fetch(
      referralAccountPubKey,
    );
    const project = await this.program.account.project.fetch(
      referralAccount.project,
    );

    const [
      referralTokenAccountPubKey,
      [partnerTokenAccount, createPartnerTokenAccountIx],
      [projectAdminTokenAccount, createProjectAdminTokenAccountIx],
    ] = await Promise.all([
      this.getReferralTokenAccountPubKey({
        referralAccountPubKey,
        mint,
      }),
      getOrCreateATAInstruction(
        mint,
        referralAccount.partner,
        this.connection,
        payerPubKey,
        undefined,
        mintAccount.owner,
      ),
      getOrCreateATAInstruction(
        mint,
        project.admin,
        this.connection,
        payerPubKey,
        undefined,
        mintAccount.owner,
      ),
    ]);

    let preInstructions: TransactionInstruction[] = [];
    if (createPartnerTokenAccountIx)
      preInstructions.push(createPartnerTokenAccountIx);
    if (createProjectAdminTokenAccountIx) {
      const projectAuthority = this.getProjectAuthorityPubKey(project);
      const ix = await this.program.methods
        .createAdminTokenAccount()
        .accounts({
          project: referralAccount.project,
          projectAuthority,
          admin: project.admin,
          projectAdminTokenAccount: projectAdminTokenAccount,
          mint,
          tokenProgram: mintAccount.owner,
        })
        .instruction();

      preInstructions.push(ix);
    }

    return await this.program.methods
      .claim()
      .accounts({
        payer: payerPubKey,
        project: referralAccount.project,
        admin: project.admin,
        projectAdminTokenAccount,
        referralAccount: referralAccountPubKey,
        referralTokenAccount: referralTokenAccountPubKey,
        partner: referralAccount.partner,
        partnerTokenAccount: partnerTokenAccount,
        mint,
        tokenProgram: mintAccount.owner,
      })
      .preInstructions(preInstructions)
      .transaction();
  }

  public async claimAll({
    payerPubKey,
    referralAccountPubKey,
  }: ClaimAllVariable): Promise<VersionedTransaction[]> {
    const blockhash = (await this.connection.getLatestBlockhash()).blockhash;
    const lookupTableAccount = await this.connection
      .getAddressLookupTable(
        new PublicKey('GBzQG2iFrPwXjGtCnwNt9S5eHd8xAR8jUMt3QDJpnjud'),
      )
      .then((res) => res.value);

    const referralAccount = await this.program.account.referralAccount.fetch(
      referralAccountPubKey,
    );
    const project = await this.program.account.project.fetch(
      referralAccount.project,
    );
    const projectAuthority = this.getProjectAuthorityPubKey(project);

    const { tokenAccounts, token2022Accounts } =
      await this.getReferralTokenAccounts(referralAccountPubKey.toString());

    const vtTxs = await Promise.all(
      [tokenAccounts, token2022Accounts].map(async (accounts, idx) => {
        const tokenProgramId =
          idx === 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
        const tokensWithAmount = accounts.filter(
          (item) => item.account.amount > 0,
        );

        // get all token accounts belong to partner and admin
        const partnerTokenAccounts =
          await this.connection.getParsedTokenAccountsByOwner(
            referralAccount.partner,
            {
              programId: tokenProgramId,
            },
          );
        const adminTokenAccounts =
          await this.connection.getParsedTokenAccountsByOwner(project.admin, {
            programId: tokenProgramId,
          });

        const claimParams = await Promise.all(
          tokensWithAmount.map(async (token) => {
            let partnerTokenAccount = partnerTokenAccounts.value.find(
              (item) =>
                token.account.mint.toBase58() ===
                item.account.data.parsed.info.mint,
            )?.pubkey;
            let projectAdminTokenAccount = adminTokenAccounts.value.find(
              (item) =>
                token.account.mint.toBase58() ===
                item.account.data.parsed.info.mint,
            )?.pubkey;
            const referralTokenAccountPubKey =
              this.getReferralTokenAccountPubKey({
                referralAccountPubKey,
                mint: token.account.mint,
              });

            const preInstructions: TransactionInstruction[] = [];

            if (!partnerTokenAccount) {
              partnerTokenAccount = getAssociatedTokenAddressSync(
                token.account.mint,
                referralAccount.partner,
                true,
                tokenProgramId,
              );
              preInstructions.push(
                createAssociatedTokenAccountInstruction(
                  payerPubKey,
                  partnerTokenAccount,
                  referralAccount.partner,
                  token.account.mint,
                  tokenProgramId,
                ),
              );
            }

            if (!projectAdminTokenAccount) {
              projectAdminTokenAccount = getAssociatedTokenAddressSync(
                token.account.mint,
                project.admin,
                true,
                tokenProgramId,
              );
              const ix = await this.program.methods
                .createAdminTokenAccount()
                .accounts({
                  project: referralAccount.project,
                  projectAuthority,
                  admin: project.admin,
                  projectAdminTokenAccount,
                  mint: token.account.mint,
                  tokenProgram: tokenProgramId,
                })
                .instruction();

              preInstructions.push(ix);
            }

            return {
              referralTokenAccountPubKey,
              projectAdminTokenAccount,
              partnerTokenAccount,
              preInstructions,
              mint: token.account.mint,
            };
          }),
        );

        const batchParams = chunk(claimParams, 5);
        return Promise.all(
          batchParams.map(async (batch) => {
            const txs = await Promise.all(
              batch.map(
                async ({
                  preInstructions,
                  mint,
                  projectAdminTokenAccount,
                  referralTokenAccountPubKey,
                  partnerTokenAccount,
                }) => {
                  return await this.program.methods
                    .claim()
                    .accounts({
                      payer: payerPubKey,
                      project: referralAccount.project,
                      admin: project.admin,
                      projectAdminTokenAccount,
                      referralAccount: referralAccountPubKey,
                      referralTokenAccount: referralTokenAccountPubKey,
                      partner: referralAccount.partner,
                      partnerTokenAccount: partnerTokenAccount,
                      mint,
                      tokenProgram: tokenProgramId,
                    })
                    .preInstructions(preInstructions)
                    .transaction();
                },
              ),
            );

            const messageV0 = new TransactionMessage({
              payerKey: payerPubKey,
              instructions: txs.flatMap((tx) => tx.instructions),
              recentBlockhash: blockhash,
            }).compileToV0Message([lookupTableAccount!]);

            return new VersionedTransaction(messageV0);
          }),
        );
      }),
    );

    return vtTxs.flat();
  }
}
