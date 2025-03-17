import { database as db } from '../common/database';
import type { BaseModel } from './index';

export type OauthProviderName = 'gitlab' | 'github';

export type GitCredentials = BaseModel & BaseGitCredentials;

export const name = 'Git Credentials';

export const type = 'GitCredentials';

export const prefix = 'git_creds';

export const canDuplicate = false;

export const canSync = false;

export function init(): BaseGitCredentials {
  return {
    token: '',
    refreshToken: '',
    provider: 'github',
    author: {
      email: '',
      name: '',
      avatarUrl: '',
    },
  };
}

interface BaseGitCredentials {
  token: string;
  refreshToken?: string;
  provider: 'githubapp' | 'github' | 'gitlab' | 'custom';
  author: {
    avatarUrl?: string;
    name: string;
    email: string;
  };
}

export function migrate(doc: GitCredentials) {
  return doc;
}

export function create(patch: Partial<GitCredentials> = {}) {
  return db.docCreate<GitCredentials>(type, patch);
}

export async function getById(id: string) {
  return db.getWhere<GitCredentials>(type, { _id: id });
}

export async function getByProvider(provider: OauthProviderName) {
  return db.getWhere<GitCredentials>(type, provider === 'github' ? { provider: 'githubapp' } : { provider: 'gitlab' });
}

export function update(credentials: GitCredentials, patch: Partial<GitCredentials>) {
  return db.docUpdate<GitCredentials>(credentials, patch);
}

export function remove(credentials: GitCredentials) {
  return db.remove(credentials);
}

export function all() {
  return db.all<GitCredentials>(type);
}

interface GitHubAuthor {
  avatar_url: string;
  name: string;
  email: string;
  avatarUrl: string;
}

async function migrateGitHubCredentialsFromLocalStorage() {
  const userInfo = window.localStorage.getItem('github-user-info');
  const token = window.localStorage.getItem('github-oauth-token');

  if (!userInfo || !token) {
    return;
  }

  try {
    const githubUser = JSON.parse(userInfo) as GitHubAuthor;

    const credentials = await getByProvider('github');

    if (credentials) {
      console.warn('GitHub credentials already exist, skipping migration');
      return;
    }

    await create({
      token,
      provider: 'github',
      author: {
        email: githubUser.email,
        name: githubUser.name,
        avatarUrl: githubUser.avatarUrl,
      },
    });

    console.log('Migrated GitHub credentials from localStorage');
    window.localStorage.removeItem('github-user-info');
    window.localStorage.removeItem('github-oauth-token');
  } catch (e) {
    console.error('Failed to parse GitHub user info', e);
  }
}

interface GitLabAuthor {
  username: string;
  name: string;
  avatar_url: string;
  public_email: any;
  email: string;
  commit_email: string;
}

async function migrateGitLabCredentialsFromLocalStorage() {
  const userInfo = window.localStorage.getItem('gitlab-user-info');
  const token = window.localStorage.getItem('gitlab-oauth-token');
  const refreshToken = window.localStorage.getItem('gitlab-oauth-refresh-token');

  if (!userInfo || !token || !refreshToken) {
    return;
  }

  try {
    const user = JSON.parse(userInfo) as GitLabAuthor;

    const credentials = await getByProvider('gitlab');

    if (credentials) {
      console.warn('GitLab credentials already exist, skipping migration');
      return;
    }

    await create({
      token,
      refreshToken,
      provider: 'gitlab',
      author: {
        email: user.commit_email ?? user.public_email ?? user.email,
        name: user.username ?? user.name,
        avatarUrl: user.avatar_url,
      },
    });

    console.log('Migrated GitLab credentials from localStorage');
    window.localStorage.removeItem('gitlab-user-info');
    window.localStorage.removeItem('gitlab-oauth-token');
    window.localStorage.removeItem('gitlab-oauth-refresh-token');
  } catch (e) {
    console.error('Failed to parse GitLab user info', e);
  }
}

export async function migrateCredentialsFromLocalStorage() {
  await migrateGitHubCredentialsFromLocalStorage();
  await migrateGitLabCredentialsFromLocalStorage();
}
