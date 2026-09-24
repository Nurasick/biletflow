import pytest
from pydantic import BaseModel

from app.main import app
from app.schemas.auth import LoginRequest
from app.schemas.event import EventCreate, EventUpdate
from app.schemas.ticket_type import TicketTypeCreate, TicketTypeUpdate
from app.schemas.user import UserCreate

# Every request body that carries a Swagger example. Add new ones here.
SCHEMAS_WITH_EXAMPLES: list[type[BaseModel]] = [
    EventCreate,
    EventUpdate,
    LoginRequest,
    TicketTypeCreate,
    TicketTypeUpdate,
    UserCreate,
]


@pytest.mark.parametrize("schema", SCHEMAS_WITH_EXAMPLES, ids=lambda s: s.__name__)
def test_every_example_passes_its_own_validation(schema):
    # /docs pre-fills requests from these. An example the API would reject
    # with a 422 is worse than no example at all.
    examples = schema.model_config["json_schema_extra"]["examples"]

    assert examples
    for example in examples:
        schema.model_validate(example)


def test_examples_reach_the_openapi_document():
    components = app.openapi()["components"]["schemas"]

    assert components["TicketTypeCreate"]["examples"][0]["is_hidden"] is False
    assert components["EventCreate"]["examples"][0]["slug"] == "jazz-night-almaty"
