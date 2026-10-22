'use strict';

// ─── Examples ────────────────────────────────────────────────────────────────

const EXAMPLES = {
  school: `# SchoolDatabase
Student
  Id
  Name vc(100)
  Email vc(100) unique
  DateOfBirth date null

Teacher
  Id
  Name vc(100)
  Email vc(100) unique

Course
  Id
  Name vc(100)
  Credits int
  TeacherId null -> Teacher [delete set null]  # null = no teacher yet

# Junction table: Student ↔ Course
Enrollment
  StudentId -> Student [delete cascade]
  CourseId -> Course [delete cascade]
  EnrollmentDate date [default now]
  Grade int null  # null = not graded yet
  pk (StudentId, CourseId)
`,
  store: `# ClothingShop
OrderStatus
  Id
  Name

ReturnStatus
  Id
  Name

ReturnReason
  Id
  Name

RejectReason
  Id
  Name
  Message text null  # standard message to the customer

Customer
  Id
  FName
  LName
  Address null
  City null
  BirthYear int null
  Email

COrder
  Id
  CreatedDate datetime
  StatusId -> OrderStatus
  CustomerId -> Customer
  Source vc(50) null  # e.g. Direkt, Google, Instagram, Nyhetsbrev

ProductToOrder
  Id
  OrderId -> COrder
  VariantId -> Variant
  Name  # name at purchase time
  Description text null
  Quantity int
  UnitPrice decimal(12,2)  # price per unit at purchase time

ProductCategory
  Id
  Name
  ParentCategoryId null -> ProductCategory

Product
  Id
  Name
  Description text null
  CategoryId -> ProductCategory
  Cost int  # purchase price per unit

Variant
  Id
  ProductId -> Product
  Name
  Description text null
  ImageURL vc(255) null
  Stock int

ProductPrice
  Id
  ProductId -> Product
  StartDate datetime  # price valid from this date
  Price int

Return
  Id
  PToOId -> ProductToOrder
  QuantityReturned int
  IncomeDate date  # when the return arrived
  BackToCDate date null  # if shipped back to the customer
  BackToCMessage text null
  ReturnStatusId -> ReturnStatus
  ReasonId -> ReturnReason
  RejectReasonId null -> RejectReason  # set if rejected
  HandlerNote text null  # internal note by staff
`,
};
