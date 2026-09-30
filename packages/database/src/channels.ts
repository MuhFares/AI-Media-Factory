/**
 * Program 5 — canonical channel registry + credential bindings.
 *
 * A channel is an external publishing destination owned by exactly one
 * project — never a bare credential. Credential bindings are OPAQUE
 * references (labels); raw secrets never enter these tables. Publishing
 * route resolution fails closed on any project/channel/binding mismatch
 * before any provider execution. No provider calls happen here.
 */

export type ChannelPlatform = "youtube";
export type ChannelStatus = "PENDING" | "VERIFIED" | "SUSPENDED";
export type BindingStatus = "ACTIVE" | "REVOKED";

/** Extensible platform taxonomy. Only youtube is implemented; every other
 *  value is explicitly unsupported (never fake adapters). */
export const CHANNEL_PLATFORMS: Readonly<Record<string, {
  readonly implemented: boolean;
  readonly visibilities: readonly string[];
  readonly analytics: boolean;
  readonly note: string;
}>> = {
  youtube: {
    implemented: true,
    visibilities: ["private", "unlisted", "public"],
    analytics: true,
    note: "YouTube Data API v3 + Analytics v2 via governed adapters",
  },
  tiktok: { implemented: false, visibilities: [], analytics: false, note: "taxonomy reserved; no adapter" },
  instagram: { implemented: false, visibilities: [], analytics: false, note: "taxonomy reserved; no adapter" },
  facebook: { implemented: false, visibilities: [], analytics: false, note: "taxonomy reserved; no adapter" },
  x: { implemented: false, visibilities: [], analytics: false, note: "taxonomy reserved; no adapter" },
  other: { implemented: false, visibilities: [], analytics: false, note: "taxonomy reserved; no adapter" },
};

export function platformSupported(platform: string): boolean {
  return CHANNEL_PLATFORMS[platform]?.implemented === true;
}

export interface ChannelRecord {
  channelId: string; projectId: string; platform: string;
  externalChannelId: string | null; handle: string | null; displayName: string;
  status: ChannelStatus; capabilities: Record<string, unknown>;
  verifiedAt: string | null; verificationNote: string | null;
  createdAt: string; updatedAt: string;
}

export interface CredentialBinding {
  bindingId: string; projectId: string; channelId: string | null;
  provider: string; credentialRef: string; status: BindingStatus;
  createdAt: string; updatedAt: string;
}

export interface PublicationRoute {
  readonly projectId: string;
  readonly channelId: string;
  readonly platform: string;
  readonly externalChannelId: string;
  readonly bindingId: string;
  readonly visibility: string;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const channelRow = (r: any): ChannelRecord => ({
  channelId: r.channel_id, projectId: r.project_id, platform: r.platform,
  externalChannelId: r.external_channel_id ?? null, handle: r.handle ?? null,
  displayName: r.display_name, status: r.status,
  capabilities: (typeof r.capabilities === "string" ? JSON.parse(r.capabilities) : r.capabilities) ?? {},
  verifiedAt: r.verified_at ?? null, verificationNote: r.verification_note ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const bindingRow = (r: any): CredentialBinding => ({
  bindingId: r.binding_id, projectId: r.project_id, channelId: r.channel_id ?? null,
  provider: r.provider, credentialRef: r.credential_ref, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export class ChannelStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly pool: any) {}

  async createChannel(input: {
    projectId: string; platform: string; displayName: string;
    handle?: string | null; externalChannelId?: string | null;
    capabilities?: Record<string, unknown>;
  }): Promise<ChannelRecord> {
    if (!input.projectId) throw new Error("CHANNEL_PROJECT_REQUIRED");
    if (!CHANNEL_PLATFORMS[input.platform]) throw new Error("CHANNEL_PLATFORM_UNKNOWN");
    if (!platformSupported(input.platform)) throw new Error("CHANNEL_PLATFORM_UNSUPPORTED");
    if (!input.displayName.trim()) throw new Error("CHANNEL_NAME_REQUIRED");
    const now = new Date().toISOString();
    const id = generateId("channel");
    await this.pool.query(
      `INSERT INTO channels (channel_id,project_id,platform,external_channel_id,handle,display_name,status,capabilities,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$8)`,
      [id, input.projectId, input.platform, input.externalChannelId ?? null,
        input.handle?.trim() || null, input.displayName.trim(),
        JSON.stringify(input.capabilities ?? {}), now]);
    const created = await this.getChannel(id);
    if (!created) throw new Error("CHANNEL_PERSISTENCE_FAILED");
    return created;
  }

  async getChannel(channelId: string): Promise<ChannelRecord | null> {
    const q = await this.pool.query(`SELECT * FROM channels WHERE channel_id=$1`, [channelId]);
    return q.rowCount ? channelRow(q.rows[0]) : null;
  }

  async listChannels(projectId: string, limit = 100): Promise<ChannelRecord[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(
      `SELECT * FROM channels WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map(channelRow);
  }

  /**
   * Owner attestation binding: the Owner confirms the external identity
   * (e.g. checked in YouTube Studio) with a rationale. No provider call.
   */
  async verifyChannel(input: {
    channelId: string; externalChannelId: string; handle?: string | null; rationale: string;
  }): Promise<ChannelRecord | null> {
    if (!input.externalChannelId.trim()) throw new Error("CHANNEL_EXTERNAL_ID_REQUIRED");
    if (!input.rationale.trim()) throw new Error("CHANNEL_VERIFY_RATIONALE_REQUIRED");
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE channels SET status='VERIFIED',external_channel_id=$2,handle=COALESCE($3,handle),
        verified_at=$4,verification_note=$5,updated_at=$4 WHERE channel_id=$1`,
      [input.channelId, input.externalChannelId.trim(), input.handle?.trim() || null, now, input.rationale.trim()]);
    return this.getChannel(input.channelId);
  }

  async suspendChannel(channelId: string): Promise<ChannelRecord | null> {
    await this.pool.query(`UPDATE channels SET status='SUSPENDED',updated_at=$2 WHERE channel_id=$1`,
      [channelId, new Date().toISOString()]);
    return this.getChannel(channelId);
  }

  /** Opaque credential binding. The credentialRef is a label/handle only. */
  async bindCredential(input: {
    projectId: string; channelId?: string | null; provider: string; credentialRef: string;
  }): Promise<CredentialBinding> {
    if (!input.projectId) throw new Error("CHANNEL_BINDING_PROJECT_REQUIRED");
    if (!input.provider.trim()) throw new Error("CHANNEL_BINDING_PROVIDER_REQUIRED");
    if (!input.credentialRef.trim() || input.credentialRef.length > 200) {
      throw new Error("CHANNEL_BINDING_REF_INVALID");
    }
    if (input.channelId) {
      const ch = await this.getChannel(input.channelId);
      if (!ch || ch.projectId !== input.projectId) throw new Error("CHANNEL_BINDING_CHANNEL_MISMATCH");
    }
    const now = new Date().toISOString();
    const id = generateId("binding");
    await this.pool.query(
      `INSERT INTO credential_bindings (binding_id,project_id,channel_id,provider,credential_ref,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$6)`,
      [id, input.projectId, input.channelId ?? null, input.provider.trim(), input.credentialRef.trim(), now]);
    const q = await this.pool.query(`SELECT * FROM credential_bindings WHERE binding_id=$1`, [id]);
    return bindingRow(q.rows[0]);
  }

  async revokeBinding(bindingId: string): Promise<CredentialBinding | null> {
    await this.pool.query(`UPDATE credential_bindings SET status='REVOKED',updated_at=$2 WHERE binding_id=$1`,
      [bindingId, new Date().toISOString()]);
    const q = await this.pool.query(`SELECT * FROM credential_bindings WHERE binding_id=$1`, [bindingId]);
    return q.rowCount ? bindingRow(q.rows[0]) : null;
  }

  async listBindings(projectId: string): Promise<CredentialBinding[]> {
    const q = await this.pool.query(
      `SELECT * FROM credential_bindings WHERE project_id=$1 ORDER BY created_at DESC`, [projectId]);
    return q.rows.map(bindingRow);
  }

  /**
   * Ownership-guarded publication route resolution (dry-run capable).
   * Project, channel, binding, platform capability, visibility, and
   * verification must ALL agree or it throws fail-closed. Never executes.
   */
  async resolvePublicationRoute(input: {
    projectId: string; channelId: string; bindingId: string; visibility: string;
  }): Promise<PublicationRoute> {
    const channel = await this.getChannel(input.channelId);
    if (!channel || channel.projectId !== input.projectId) {
      throw new Error("CHANNEL_OWNERSHIP_MISMATCH");
    }
    if (channel.status !== "VERIFIED") throw new Error("CHANNEL_NOT_VERIFIED");
    if (!channel.externalChannelId) throw new Error("CHANNEL_EXTERNAL_IDENTITY_MISSING");
    const platform = CHANNEL_PLATFORMS[channel.platform];
    if (!platform || !platform.implemented) throw new Error("CHANNEL_PLATFORM_UNSUPPORTED");
    if (!platform.visibilities.includes(input.visibility)) {
      throw new Error("CHANNEL_VISIBILITY_UNSUPPORTED");
    }
    const bq = await this.pool.query(`SELECT * FROM credential_bindings WHERE binding_id=$1`, [input.bindingId]);
    if (!bq.rowCount) throw new Error("CHANNEL_BINDING_UNKNOWN");
    const binding = bindingRow(bq.rows[0]);
    if (binding.projectId !== input.projectId) throw new Error("CHANNEL_BINDING_PROJECT_MISMATCH");
    if (binding.channelId && binding.channelId !== input.channelId) {
      throw new Error("CHANNEL_BINDING_CHANNEL_MISMATCH");
    }
    if (binding.status !== "ACTIVE") throw new Error("CHANNEL_BINDING_REVOKED");
    return {
      projectId: channel.projectId, channelId: channel.channelId,
      platform: channel.platform, externalChannelId: channel.externalChannelId,
      bindingId: binding.bindingId, visibility: input.visibility,
    };
  }
}
