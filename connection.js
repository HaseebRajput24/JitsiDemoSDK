/* global APP, JitsiMeetJS, config */

import { jitsiLocalStorage } from '@jitsi/js-utils';
import Logger from '@jitsi/logger';

import { redirectToTokenAuthService } from './modules/UI/authentication/AuthHandler';
import { LoginDialog } from './react/features/authentication/components';
import { isTokenAuthEnabled } from './react/features/authentication/functions';
import {
    connectionEstablished,
    connectionFailed,
    constructOptions
} from './react/features/base/connection/actions.web';
import { openDialog } from './react/features/base/dialog/actions';
import { setJWT } from './react/features/base/jwt';
import {
    JitsiConnectionErrors,
    JitsiConnectionEvents
} from './react/features/base/lib-jitsi-meet';
import { isFatalJitsiConnectionError } from './react/features/base/lib-jitsi-meet/functions';
import { getCustomerDetails } from './react/features/jaas/actions.any';
import { getJaasJWT, isVpaasMeeting } from './react/features/jaas/functions';
import {
    setPrejoinDisplayNameRequired
} from './react/features/prejoin/actions';
const logger = Logger.getLogger(__filename);

/**
 * The feature announced so we can distinguish jibri participants.
 *
 * @type {string}
 */
export const DISCO_JIBRI_FEATURE = 'http://jitsi.org/protocol/jibri';

/**
 * Try to open connection using provided credentials.
 * @param {string} [id]
 * @param {string} [password]
 * @returns {Promise<JitsiConnection>} connection if
 * everything is ok, else error.
 */
export async function connect(id, password) {
    const state = APP.store.getState();
    let { jwt } = state['features/base/jwt'];
    const { iAmRecorder, iAmSipGateway } = state['features/base/config'];

    if (!iAmRecorder && !iAmSipGateway && isVpaasMeeting(state)) {
        await APP.store.dispatch(getCustomerDetails());

        if (!jwt) {
            jwt = await getJaasJWT(state);
            APP.store.dispatch(setJWT(jwt));
        }
    }

    const connection = new JitsiMeetJS.JitsiConnection(null, jwt, constructOptions(state));

    if (config.iAmRecorder) {
        connection.addFeature(DISCO_JIBRI_FEATURE);
    }

    return new Promise((resolve, reject) => {
        connection.addEventListener(
            JitsiConnectionEvents.CONNECTION_ESTABLISHED,
            handleConnectionEstablished);
        connection.addEventListener(
            JitsiConnectionEvents.CONNECTION_FAILED,
            handleConnectionFailed);
        connection.addEventListener(
            JitsiConnectionEvents.CONNECTION_FAILED,
            connectionFailedHandler);
        connection.addEventListener(
            JitsiConnectionEvents.DISPLAY_NAME_REQUIRED,
            displayNameRequiredHandler
        );

        /* eslint-disable max-params */
        /**
         *
         */
        function connectionFailedHandler(error, message, credentials, details) {
        /* eslint-enable max-params */
            APP.store.dispatch(
                connectionFailed(
                    connection, {
                        credentials,
                        details,
                        message,
                        name: error
                    }));

            if (isFatalJitsiConnectionError(error)) {
                connection.removeEventListener(
                    JitsiConnectionEvents.CONNECTION_FAILED,
                    connectionFailedHandler);
            }
        }

        /**
         *
         */
        function unsubscribe() {
            connection.removeEventListener(
                JitsiConnectionEvents.CONNECTION_ESTABLISHED,
                handleConnectionEstablished);
            connection.removeEventListener(
                JitsiConnectionEvents.CONNECTION_FAILED,
                handleConnectionFailed);
        }

        /**
         *
         */
        function handleConnectionEstablished() {
            APP.store.dispatch(connectionEstablished(connection, Date.now()));
            unsubscribe();
            resolve(connection);
        }

        /**
         *
         */
        function handleConnectionFailed(err) {
            unsubscribe();
            logger.error('CONNECTION FAILED:', err);
            reject(err);
        }

        /**
         * Marks the display name for the prejoin screen as required.
         * This can happen if a user tries to join a room with lobby enabled.
         */
        function displayNameRequiredHandler() {
            APP.store.dispatch(setPrejoinDisplayNameRequired());
        }

        connection.connect({
            id,
            password
        });
    });
}

/**
 * Open JitsiConnection using provided credentials.
 * If retry option is true it will show auth dialog on PASSWORD_REQUIRED error.
 *
 * @param {object} options
 * @param {string} [options.id]
 * @param {string} [options.password]
 * @param {string} [options.roomName]
 * @param {boolean} [retry] if we should show auth dialog
 * on PASSWORD_REQUIRED error.
 *
 * @returns {Promise<JitsiConnection>}
 */
export function openConnection({ id, password, retry, roomName }) {
    const usernameOverride
        = jitsiLocalStorage.getItem('xmpp_username_override');
    const passwordOverride
        = jitsiLocalStorage.getItem('xmpp_password_override');

    if (usernameOverride && usernameOverride.length > 0) {
        id = usernameOverride; // eslint-disable-line no-param-reassign
    }
    if (passwordOverride && passwordOverride.length > 0) {
        password = passwordOverride; // eslint-disable-line no-param-reassign
    }

    return connect(id, password).catch(err => {
        if (retry) {
            const { jwt } = APP.store.getState()['features/base/jwt'];

            if (err === JitsiConnectionErrors.PASSWORD_REQUIRED && !jwt) {
                return requestAuth(roomName);
            }
        }

        throw err;
    });
}

/**
 * Show Authentication Dialog and try to connect with new credentials.
 * If failed to connect because of PASSWORD_REQUIRED error
 * then ask for password again.
 * @param {string} [roomName] name of the conference room
 *
 * @returns {Promise<JitsiConnection>}
 */
function requestAuth(roomName) {
    const config = APP.store.getState()['features/base/config'];

    if (isTokenAuthEnabled(config)) {
        // This Promise never resolves as user gets redirected to another URL
        return new Promise(() => redirectToTokenAuthService(roomName));
    }

    return new Promise(resolve => {
        const onSuccess = connection => {
            resolve(connection);
        };

        APP.store.dispatch(
            openDialog(LoginDialog, { onSuccess,
                roomName })
        );
    });
}
