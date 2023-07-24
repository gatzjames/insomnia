import { IpcRendererEvent } from 'electron';
import React, { useEffect, useState } from 'react';
import { Outlet, useFetcher, useParams } from 'react-router-dom';
import styled from 'styled-components';

import { isDevelopment } from '../../common/constants';
import * as models from '../../models';
import { reloadPlugins } from '../../plugins';
import { createPlugin } from '../../plugins/create';
import { setTheme } from '../../plugins/misc';
import { exchangeCodeForToken } from '../../sync/git/github-oauth-provider';
import { exchangeCodeForGitLabToken } from '../../sync/git/gitlab-oauth-provider';
import { AppHeader } from '../components/app-header';
import { ErrorBoundary } from '../components/error-boundary';
import { showError, showModal } from '../components/modals';
import { AlertModal } from '../components/modals/alert-modal';
import { AskModal } from '../components/modals/ask-modal';
import { ImportModal } from '../components/modals/import-modal';
import { SettingsModal, TAB_INDEX_PLUGINS, TAB_INDEX_THEMES } from '../components/modals/settings-modal';
import { SvgIcon } from '../components/svg-icon';
import { Toast } from '../components/toast';
import { AppHooks } from '../containers/app-hooks';
import { NunjucksEnabledProvider } from '../context/nunjucks/nunjucks-enabled-context';
import Modals from './modals';

const Layout = styled.div({
  position: 'relative',
  height: '100%',
  width: '100%',
  display: 'grid',
  backgroundColor: 'var(--color-bg)',
  gridTemplate: `
    'Header Header' auto
    'Navbar Content' 1fr
    'Statusbar Statusbar' 30px [row-end]
    / 50px 1fr;
  `,
});

const ScratchPad = () => {
  const { organizationId } = useParams() as {
    organizationId: string;
  };

  const [importUri, setImportUri] = useState('');

  const actionFetcher = useFetcher();

  useEffect(() => {
    return window.main.on(
      'shell:open',
      async (_: IpcRendererEvent, url: string) => {
        // Get the url without params
        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch (err) {
          console.log('Invalid args, expected insomnia://x/y/z', url);
          return;
        }
        let urlWithoutParams = url.substring(0, url.indexOf('?')) || url;
        const params = Object.fromEntries(parsedUrl.searchParams);
        // Change protocol for dev redirects to match switch case
        if (isDevelopment()) {
          urlWithoutParams = urlWithoutParams.replace(
            'insomniadev://',
            'insomnia://'
          );
        }
        switch (urlWithoutParams) {
          case 'insomnia://app/alert':
            showModal(AlertModal, {
              title: params.title,
              message: params.message,
            });
            break;

          case 'insomnia://app/auth/login':
            actionFetcher.submit({}, {
              action: '/auth/logout',
              method: 'POST',
            });
            break;

          case 'insomnia://app/import':
            setImportUri(params.uri);
            break;

          case 'insomnia://plugins/install':
            showModal(AskModal, {
              title: 'Plugin Install',
              message: (
                <>
                  Do you want to install <code>{params.name}</code>?
                </>
              ),
              yesText: 'Install',
              noText: 'Cancel',
              onDone: async (isYes: boolean) => {
                if (isYes) {
                  try {
                    await window.main.installPlugin(params.name);
                    showModal(SettingsModal, { tab: TAB_INDEX_PLUGINS });
                  } catch (err) {
                    showError({
                      title: 'Plugin Install',
                      message: 'Failed to install plugin',
                      error: err.message,
                    });
                  }
                }
              },
            });
            break;

          case 'insomnia://plugins/theme':
            const parsedTheme = JSON.parse(decodeURIComponent(params.theme));
            showModal(AskModal, {
              title: 'Install Theme',
              message: (
                <>
                  Do you want to install <code>{parsedTheme.displayName}</code>?
                </>
              ),
              yesText: 'Install',
              noText: 'Cancel',
              onDone: async (isYes: boolean) => {
                if (isYes) {
                  const mainJsContent = `module.exports.themes = [${JSON.stringify(
                    parsedTheme,
                    null,
                    2
                  )}];`;
                  await createPlugin(
                    `theme-${parsedTheme.name}`,
                    '0.0.1',
                    mainJsContent
                  );
                  const settings = await models.settings.getOrCreate();
                  await models.settings.update(settings, {
                    theme: parsedTheme.name,
                  });
                  await reloadPlugins();
                  await setTheme(parsedTheme.name);
                  showModal(SettingsModal, { tab: TAB_INDEX_THEMES });
                }
              },
            });
            break;

          case 'insomnia://oauth/github/authenticate': {
            const { code, state } = params;
            await exchangeCodeForToken({ code, state }).catch(
              (error: Error) => {
                showError({
                  error,
                  title: 'Error authorizing GitHub',
                  message: error.message,
                });
              }
            );
            break;
          }

          case 'insomnia://oauth/gitlab/authenticate': {
            const { code, state } = params;
            await exchangeCodeForGitLabToken({ code, state }).catch(
              (error: Error) => {
                showError({
                  error,
                  title: 'Error authorizing GitLab',
                  message: error.message,
                });
              }
            );
            break;
          }

          case 'insomnia://app/auth/finish': {
            actionFetcher.submit({
              code: params.box,
            }, {
              action: '/auth/authorize',
              method: 'POST',
              'encType': 'application/json',
            });
            break;
          }

          default: {
            console.log(`Unknown deep link: ${url}`);
          }
        }
      }
    );
  }, [actionFetcher]);

  return (

    <NunjucksEnabledProvider>
      <AppHooks />
      <div className="app">
        <ErrorBoundary showAlert>
          {/* triggered by insomnia://app/import */}
          {importUri && (
            <ImportModal
              onHide={() => setImportUri('')}
              projectName="Insomnia"
              organizationId={organizationId}
              from={{ type: 'uri', defaultValue: importUri }}
            />
          )}
          <Modals />
          <Layout>
            <div style={{ gridArea: 'Navbar', backgroundColor: 'blue' }} />
            <AppHeader />
            <Outlet />
            <Bar>
              <KongLink className="made-with-love" href="https://konghq.com/">
                Made with&nbsp; <SvgIcon icon="heart" /> &nbsp;by Kong
              </KongLink>
            </Bar>
          </Layout>
        </ErrorBoundary>

        <ErrorBoundary showAlert>
          <Toast />
        </ErrorBoundary>
      </div>
    </NunjucksEnabledProvider>
  );
};

export default ScratchPad;

const Bar = styled.div({
  position: 'relative',
  gridArea: 'Statusbar',
  borderTop: '1px solid var(--hl-md)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  overflow: 'hidden',
});

const KongLink = styled.a({
  '&&': {
    display: 'flex',
    alignItems: 'center',
    fontSize: 'var(--font-size-xs)',
    padding: '0 var(--padding-md)',
    justifyContent: 'flex-end',
    boxSizing: 'border-box',
    color: 'var(--color-font)',
  },
});
