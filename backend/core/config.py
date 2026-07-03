from pydantic_settings import BaseSettings, SettingsConfigDict

from core.config_paths import DEFAULT_DB_URL, ENV_FILE


class Settings(BaseSettings):
    eia_api_key: str = ""
    fred_api_key: str = ""
    anthropic_api_key: str = ""
    tabpfn_api_key: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    db_url: str = DEFAULT_DB_URL
    env: str = "local"
    log_level: str = "INFO"
    scheduler_enabled: bool = True
    pipeline_cron_hour: int = 22
    pipeline_cron_minute: int = 0
    # Local single-user dev defaults - override both via .env for anything
    # beyond that. jwt_secret needs 32+ random bytes in any shared/deployed
    # setting; default_user_password seeds the one local account on first
    # run (db/crud.py::get_or_create_default_user) since there's no
    # registration flow.
    jwt_secret: str = "dev-only-insecure-default-secret-change-me-32bytes"
    default_user_password: str = "oilsignalyst"

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
