from uuid import uuid4

from .models import Worksheet, WorksheetResponse


class InMemoryRepository:
    """Interfaz de repositorio temporal que se puede reemplazar por persistencia en PostgreSQL."""

    def __init__(self) -> None:
        self.worksheets: dict[str, Worksheet] = {}
        self.responses: dict[str, WorksheetResponse] = {}

    def add_worksheet(self, worksheet: Worksheet) -> Worksheet:
        self.worksheets[worksheet.id] = worksheet
        return worksheet

    def list_worksheets(self, created_by: str | None = None) -> list[Worksheet]:
        worksheets = list(self.worksheets.values())
        if created_by:
            return [worksheet for worksheet in worksheets if worksheet.created_by == created_by]
        return worksheets

    def get_worksheet(self, worksheet_id: str) -> Worksheet | None:
        return self.worksheets.get(worksheet_id)

    def publish_worksheet(self, worksheet_id: str) -> Worksheet | None:
        worksheet = self.get_worksheet(worksheet_id)
        if worksheet:
            worksheet.published = True
        return worksheet

    def duplicate_worksheet(self, worksheet_id: str) -> Worksheet | None:
        worksheet = self.get_worksheet(worksheet_id)
        if not worksheet:
            return None
        duplicate = worksheet.model_copy(update={"id": str(uuid4()), "title": f"{worksheet.title} (Copia)", "published": False})
        self.add_worksheet(duplicate)
        return duplicate

    def add_response(self, response: WorksheetResponse) -> WorksheetResponse:
        self.responses[response.id] = response
        return response

    def list_responses(self, worksheet_id: str) -> list[WorksheetResponse]:
        return [response for response in self.responses.values() if response.worksheet_id == worksheet_id]


repository = InMemoryRepository()
