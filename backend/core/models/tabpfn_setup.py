import tabpfn_client

from core.config import settings

_authenticated = False


def ensure_tabpfn_authenticated() -> None:
    global _authenticated
    if _authenticated:
        return
    tabpfn_client.set_access_token(settings.tabpfn_api_key)
    _authenticated = True
