'use strict';

// ─── Examples ────────────────────────────────────────────────────────────────

const EXAMPLES = {
  tour: `# Tables: a name without indentation
# Columns: indented, "Name type flags -> Table"
# No type means vc (varchar(128)). Id is int and the primary key.

Author
  Id
  Name
  Email vc unique
  Bio text null

Book
  Id
  Title vc(200)
  Price decimal(8,2)
  AuthorId -> Author
  SequelToId null -> Book

# No Id means no primary key, unless you write pk
BookTag
  BookId pk -> Book
  Tag vc(32) pk
`,
  dogs: `# Hundutställningen
Owner
  Id
  Name

Race
  Id
  Name

Dog
  Id
  Name
  Age int
  OwnerId -> Owner
  RaceId -> Race
  Points decimal(3,1)
`,
  housing: `# Hyresvärdarna (housingdb)
Tennant
  Id
  Name
  PersonalNr vc(10)
  ApartmentId -> Apartment

Apartment
  Id
  NrRooms int
  HouseId -> House

House
  Id
  Address vc(256)

JanitorToHouse
  JanitorId -> Janitor
  HouseId -> House

Janitor
  Id
  Name
`,
  projects: `# Projektdatabasen (projectplanner)
Project
  Id
  Name
  Description text

Task
  Id
  Name
  Description text
  StartDate date
  EndDate date
  ProjectId -> Project

EtoT
  EmployeeId -> Employee
  TaskId -> Task
  HoursWorked int

Employee
  Id
  Name
  Email
`,
  store: `# Klädaffären (dbstore)
ReturnStatus
  Id
  Name

OrderStatus
  Id
  Name

Customer
  Id
  Fname
  LName
  Address
  Email

ProductCategory
  Id
  Name
  ParentCategoryId null -> ProductCategory

ProductPrice
  Id
  ProductId -> Product
  StartDate datetime
  Price int

Product
  Id
  Name
  Description text
  CategoryId -> ProductCategory

Variant
  Id
  ProductId -> Product
  Name
  Description text
  ImageURL vc(256)
  Stock int

COrder
  Id
  CreatedDate datetime
  StatusId -> OrderStatus
  CustomerId -> Customer

ProductToOrder
  Id
  OrderId -> COrder
  VariantId -> Variant
  Name
  Description text
  Quantity int
  UnitPrice decimal(10,2)

Return
  Id
  PToOId -> ProductToOrder
  QuantityReturned int
  IncomeDate date
  BackToCDate date null
  ReturnStatusId -> ReturnStatus
  Reason text
  HandlerNote text
`,
  empty: `# Write a table name, then indented columns:
`,
};
