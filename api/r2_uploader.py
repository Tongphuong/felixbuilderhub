"""Upload files to Cloudflare R2 and return public URLs."""
import os

import boto3
from botocore.client import Config


def get_r2_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_file(local_path: str, key: str, content_type: str) -> str:
    """Upload file to R2 and return public URL."""
    client = get_r2_client()
    bucket = os.environ["R2_BUCKET_NAME"]
    public_url_base = os.environ["R2_PUBLIC_URL"].rstrip("/")

    with open(local_path, "rb") as f:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=f,
            ContentType=content_type,
        )

    return f"{public_url_base}/{key}"
