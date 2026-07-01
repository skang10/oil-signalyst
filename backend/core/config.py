from pydantic_settings import BaseSettings, SettingsConfigDict

from core.config_paths import DEFAULT_DB_URL, ENV_FILE


class Settings(BaseSettings):
    eia_api_key: str = ""
    fred_api_key: str = ""
    anthropic_api_key: str = ""
    tabpfn_api_key: str = ""
    db_url: str = DEFAULT_DB_URL
    env: str = "local"
    log_level: str = "INFO"
    scheduler_enabled: bool = True
    pipeline_cron_hour: int = 22
    pipeline_cron_minute: int = 0

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
