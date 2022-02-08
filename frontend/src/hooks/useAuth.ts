import Cookies from "universal-cookie";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { UnsupportedChainIdError, useWeb3React } from "@web3-react/core";
import { BscConnector, NoBscProviderError } from "@binance-chain/bsc-connector";
import {
  NoEthereumProviderError,
  UserRejectedRequestError as UserRejectedRequestErrorInjected,
} from "@web3-react/injected-connector";
import {
  UserRejectedRequestError as UserRejectedRequestErrorWalletConnect,
  WalletConnectConnector,
} from "@web3-react/walletconnect-connector";
import useWeb3Provider from "./useActiveWeb3React";
import {
  ConnectorNames,
  connectorLocalStorageKey,
} from "@pancakeswap-libs/uikit";
import useToast from './useToast'
import { hexlify } from "@ethersproject/bytes";
import { toUtf8Bytes } from "@ethersproject/strings";
import { connectorsByName } from "../utils/web3React";
import { setupNetwork } from "../utils/wallet";
import * as actions from "../store/actions";
import { fetchAccessToken } from "../store/actions/thunks";
import { fetchAuthInfo } from "../store/actions/thunks";

const appChainId = process.env.REACT_APP_CHAIN_ID;
const backendUrl = process.env.REACT_APP_BACKEND_URL;

const useAuth = () => {
  const { chainId, activate, deactivate, account } = useWeb3React();
  const { library, connector } = useWeb3Provider();
  const { toastError, toastInfo } = useToast()
  const dispatch = useDispatch();
  const cookies = new Cookies();

  const login = useCallback(
    (connectorID: ConnectorNames) => {
      const wConnector = connectorsByName[connectorID];
      if (wConnector) {
        if (chainId && appChainId === chainId.toString()) {
          signin(account, library, dispatch);
        } else {
          activate(wConnector, async (error: Error) => {
            if (error instanceof UnsupportedChainIdError) {
              const hasSetup = await setupNetwork();
              if (hasSetup) {
                signin(account, library, dispatch);
                activate(wConnector);
              }
            } else {
              window.localStorage.removeItem(connectorLocalStorageKey);
              if (
                error instanceof NoEthereumProviderError ||
                error instanceof NoBscProviderError
              ) {
                toastError("Error", "No provider was found");
              } else if (
                error instanceof UserRejectedRequestErrorInjected ||
                error instanceof UserRejectedRequestErrorWalletConnect
              ) {
                if (wConnector instanceof WalletConnectConnector) {
                  const walletConnector = wConnector as WalletConnectConnector;
                  walletConnector.walletConnectProvider = null;
                }
                toastInfo("Information", "Please authorize to access your account");
              } else {
                toastError("Error", error.message);
              }
            }
          });
        }
      } else {
        toastError("Error", "The connector config is wrong");
      }
    },
    [activate]
  );

  const logout = useCallback(() => {
    dispatch(actions.getAccessToken.failure());
    dispatch(actions.setAuthStatus.failure());
    cookies.remove(process.env.REACT_APP_TOKEN_COOKIE_NAME);
    cookies.remove(process.env.REACT_APP_ADDRESS_COOKIE_NAME);
    if (window.localStorage.getItem("walletconnect")) {
      connectorsByName.walletconnect.close();
      connectorsByName.walletconnect.walletConnectProvider = null;
    }
    window.localStorage.removeItem(connectorLocalStorageKey);
    toastInfo("Information", "Successfully logout!");
  }, [deactivate]);

  const signin = async (public_address, provider, dispatch) => {
    var user_obj = await fetch(
      `${backendUrl}/vega/singleuser?publicAddress=${public_address}`
    ).then((response) => response.json());

    let current_user =
      user_obj.user.length && user_obj.user.length != 0
        ? {
            public_address: user_obj.user[0].public_address,
            nonce: user_obj.user[0].nonce,
          }
        : await handleSignup(public_address);

    // Popup MetaMask confirmation modal to sign message
    let signature_obj = await handleSignMessage(
      current_user.public_address,
      current_user.nonce,
      provider
    );

    if (signature_obj) {
      await dispatch(fetchAccessToken(account, signature_obj.mysignature));
      await dispatch(fetchAuthInfo(account));
    }
  };

  const handleSignup = (publicAddress) => {
    return fetch(`${process.env.REACT_APP_BACKEND_URL}/vega/createuser`, {
      body: JSON.stringify({ public_address: publicAddress }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }).then((response) => response.json());
  };

  const handleSignMessage = async (public_address, nonce, provider) => {
    try {
      var mysignature = "";
      const message = `I am signing into vega NFT marketplace with my one-time nonce: ${nonce}`;
      if (window.BinanceChain && connector instanceof BscConnector) {
        const { signature } = await window.BinanceChain.bnbSign(
          public_address,
          message
        );
        mysignature = signature;
      } else if (provider.provider?.wc) {
        /**
         * Wallet Connect does not sign the message correctly unless you use their method
         * @see https://github.com/WalletConnect/walletconnect-monorepo/issues/462
         */
        const wcMessage = hexlify(toUtf8Bytes(message));
        const signature = await provider.provider?.wc.signPersonalMessage([
          wcMessage,
          public_address,
        ]);
        mysignature = signature;
      } else {
        mysignature = await provider.getSigner(public_address).signMessage(message);
      }
      return { mysignature };
    } catch (err) {
      return false;
    }
  };

  return { login, logout };
};

export default useAuth;